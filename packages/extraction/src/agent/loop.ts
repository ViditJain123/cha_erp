import { zodResponsesFunction, zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';

/**
 * A tool loop over the OpenAI Responses API, with a budget.
 *
 * The SDK ships a runner for Chat Completions and none for Responses, and the
 * whole loop is a hundred lines, so it is written here rather than borrowed:
 * call the model, run the function calls it made, hand the outputs back under
 * `previous_response_id`, repeat until it answers in the final schema or the
 * budget runs out. Nothing in this file knows what the tools are for.
 *
 * The budget is the point. A model with tools and no ceiling reads every page
 * it can reach; this one is told how many turns, tool calls, web searches and
 * output tokens it has, and when any of them is spent it gets exactly one more
 * turn, with no tools, to write down what it has.
 */

export type ToolOutputPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_file'; filename: string; file_data: string }
  | { type: 'input_image'; image_url: string; detail: 'high' | 'low' };

export type ToolOutput = string | ToolOutputPart[];

export interface ToolDef<A = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<A>;
  handler: (args: A) => Promise<ToolOutput>;
  /** How many times this run may call it. Beyond that the tool is withdrawn. */
  maxCalls?: number;
}

/**
 * A tool whose argument type is its own zod schema's. The loop only ever
 * calls a handler with what that schema parsed, so the erasure is safe.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDef = ToolDef<any>;

export interface LoopBudget {

  maxTurns: number;
  maxToolCalls: number;
  maxWebSearches: number;
  /** Per turn while tools are available; reasoning tokens count. */
  maxOutputTokens: number;
  /** For the final answer, which is long. */
  finalMaxOutputTokens: number;
  deadlineMs: number;
  reasoningEffort: 'low' | 'medium' | 'high';
}

export const DEFAULT_BUDGET: LoopBudget = {
  maxTurns: 8,
  maxToolCalls: 30,
  maxWebSearches: 3,
  maxOutputTokens: 8_000,
  finalMaxOutputTokens: 12_000,
  deadlineMs: 120_000,
  reasoningEffort: 'medium',
};

export interface LoopUsage {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

export interface ToolCallTrace {
  turn: number;
  name: string;
  args: unknown;
  /** The first 200 characters of a text result, or what kind of parts came back. */
  resultDigest: string;
  ms: number;
  error?: string;
}

export interface WebSearchTrace {
  turn: number;
  queries: string[];
  urls: string[];
}

export interface TurnTrace {
  turn: number;
  responseId: string;
  status: string;
  toolCalls: ToolCallTrace[];
  webSearches: WebSearchTrace[];
  usage: LoopUsage;
}

export type LoopStatus = 'ok' | 'budget' | 'invalid' | 'error';

export interface LoopResult<T> {
  status: LoopStatus;
  result: T | null;
  turns: TurnTrace[];
  usage: LoopUsage;
  responseIds: string[];
  error?: string;
}

/** What a response looks like to the loop; the real client returns a superset. */
export interface ParsedResponseLike {
  id: string;
  status?: string | null;
  incomplete_details?: { reason?: string | null } | null;
  output: unknown[];
  output_parsed: unknown;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number } | null;
    output_tokens_details?: { reasoning_tokens?: number } | null;
  } | null;
}

/** The slice of the OpenAI client the loop uses, so a test can hand in a script. */
export interface ResponsesClient {
  responses: { parse(body: Record<string, unknown>): Promise<ParsedResponseLike> };
}

export type InputItem = Record<string, unknown>;

export interface ToolLoopOptions<T> {
  client: ResponsesClient;
  model: string;
  instructions: string;
  input: InputItem[];
  tools: AnyToolDef[];
  webSearch: boolean;
  finalSchema: z.ZodType<T>;
  finalSchemaName: string;
  budget?: Partial<LoopBudget>;
}

const FINAL_NUDGE =
  'Stop investigating. Return the final answer now in the required format. Mark anything you have not settled as ' +
  'decided: false / applies: false with the reason, and put open questions in openQuestions. Do not call any tool.';

function digest(output: ToolOutput): string {
  if (typeof output === 'string') return output.length > 200 ? `${output.slice(0, 200)}…` : output;
  const kinds = output.map((p) => p.type.replace('input_', ''));
  const text = output.find((p) => p.type === 'input_text');
  return `[${kinds.join(', ')}]${text && text.type === 'input_text' ? ` ${text.text.slice(0, 120)}…` : ''}`;
}

function usageOf(response: ParsedResponseLike): LoopUsage {
  const u = response.usage;
  return {
    input: u?.input_tokens ?? 0,
    cached: u?.input_tokens_details?.cached_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

function add(total: LoopUsage, turn: LoopUsage): void {
  total.input += turn.input;
  total.cached += turn.cached;
  total.output += turn.output;
  total.reasoning += turn.reasoning;
}

interface FunctionCallItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  parsed_arguments?: unknown;
}

interface WebSearchItem {
  type: 'web_search_call';
  action?: { type?: string; query?: string; queries?: string[]; sources?: { url?: string }[] } | null;
}

function isFunctionCall(item: unknown): item is FunctionCallItem {
  return typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'function_call';
}

function isWebSearch(item: unknown): item is WebSearchItem {
  return typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'web_search_call';
}

/**
 * Run one tool call: parse the arguments against the tool's own schema and
 * hand them to its handler. Nothing here throws — a bad argument, a handler
 * that fails, a tool that no longer exists — each becomes text the model can
 * read and act on, because a thrown error ends the run with nothing.
 */
async function runCall(tools: AnyToolDef[], turn: number, call: FunctionCallItem): Promise<{ output: ToolOutput; trace: ToolCallTrace }> {
  const started = Date.now();
  const tool = tools.find((t) => t.name === call.name);
  let args: unknown = call.parsed_arguments;
  if (args === undefined) {
    try {
      args = JSON.parse(call.arguments || '{}');
    } catch {
      args = undefined;
    }
  }
  const trace: ToolCallTrace = { turn, name: call.name, args, resultDigest: '', ms: 0 };
  if (!tool) {
    trace.error = 'unknown tool';
    trace.resultDigest = trace.error;
    trace.ms = Date.now() - started;
    return { output: `Error: "${call.name}" is not a tool of this run.`, trace };
  }
  const parsed = tool.parameters.safeParse(args);
  if (!parsed.success) {
    trace.error = `invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`;
    trace.resultDigest = trace.error;
    trace.ms = Date.now() - started;
    return { output: `Error: ${trace.error}`, trace };
  }
  try {
    const output = await tool.handler(parsed.data);
    trace.resultDigest = digest(output);
    trace.ms = Date.now() - started;
    return { output, trace };
  } catch (err) {
    trace.error = (err as Error).message;
    trace.resultDigest = `error: ${trace.error}`;
    trace.ms = Date.now() - started;
    return { output: `Error: the tool failed — ${trace.error}`, trace };
  }
}

export async function runToolLoop<T>(opts: ToolLoopOptions<T>): Promise<LoopResult<T>> {
  const budget: LoopBudget = { ...DEFAULT_BUDGET, ...opts.budget };
  const started = Date.now();
  const calls = new Map<string, number>();
  let toolCallsTotal = 0;
  let webSearches = 0;
  const turns: TurnTrace[] = [];
  const usage: LoopUsage = { input: 0, cached: 0, output: 0, reasoning: 0 };
  const responseIds: string[] = [];
  const format = zodTextFormat(opts.finalSchema, opts.finalSchemaName);
  let previous: string | undefined;
  let input: InputItem[] = opts.input;
  let nudged = false;

  const toolsFor = (final: boolean): unknown[] => {
    if (final) return [];
    const fns = opts.tools
      .filter((t) => (calls.get(t.name) ?? 0) < (t.maxCalls ?? Number.POSITIVE_INFINITY))
      .map((t) => zodResponsesFunction({ name: t.name, parameters: t.parameters, description: t.description }));
    const web = opts.webSearch && webSearches < budget.maxWebSearches ? [{ type: 'web_search', search_context_size: 'low' }] : [];
    return [...fns, ...web];
  };

  const done = (status: LoopStatus, result: T | null, error?: string): LoopResult<T> => ({
    status,
    result,
    turns,
    usage,
    responseIds,
    ...(error && { error }),
  });

  // One more than maxTurns: the last one is the forced final answer.
  for (let turn = 1; turn <= budget.maxTurns + 1; turn++) {
    const spent = turn > budget.maxTurns || Date.now() - started > budget.deadlineMs || toolCallsTotal >= budget.maxToolCalls;
    const final = spent;
    if (final && !nudged) {
      input = [...input, { role: 'user', content: FINAL_NUDGE }];
      nudged = true;
    }

    let response: ParsedResponseLike;
    try {
      response = await opts.client.responses.parse({
        model: opts.model,
        // Re-sent every turn: instructions do not carry over under
        // previous_response_id.
        instructions: opts.instructions,
        input,
        ...(previous && { previous_response_id: previous }),
        tools: toolsFor(final),
        text: { format },
        reasoning: { effort: budget.reasoningEffort },
        max_output_tokens: final ? budget.finalMaxOutputTokens : budget.maxOutputTokens,
        include: ['web_search_call.action.sources'],
      });
    } catch (err) {
      return done('error', null, (err as Error).message);
    }

    previous = response.id;
    responseIds.push(response.id);
    const turnUsage = usageOf(response);
    add(usage, turnUsage);
    const trace: TurnTrace = { turn, responseId: response.id, status: response.status ?? 'unknown', toolCalls: [], webSearches: [], usage: turnUsage };

    const pending: FunctionCallItem[] = [];
    for (const item of response.output) {
      if (isFunctionCall(item)) pending.push(item);
      else if (isWebSearch(item)) {
        webSearches++;
        const action = item.action ?? {};
        trace.webSearches.push({
          turn,
          queries: action.queries ?? (action.query ? [action.query] : []),
          urls: (action.sources ?? []).map((s) => s.url ?? '').filter(Boolean),
        });
      }
    }

    const outputs: InputItem[] = [];
    if (pending.length) {
      const results = await Promise.all(pending.map((call) => runCall(opts.tools, turn, call)));
      for (const [i, call] of pending.entries()) {
        const { output, trace: callTrace } = results[i]!;
        calls.set(call.name, (calls.get(call.name) ?? 0) + 1);
        toolCallsTotal++;
        trace.toolCalls.push(callTrace);
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output });
      }
    }
    turns.push(trace);

    if (response.output_parsed != null) {
      const check = opts.finalSchema.safeParse(response.output_parsed);
      return check.success ? done('ok', check.data) : done('invalid', null, check.error.message);
    }

    if (outputs.length) {
      // Tool results go back; the final nudge, if due, is added at the top of
      // the next iteration so the pending calls are always answered first.
      input = outputs;
      continue;
    }

    // No answer and no tool calls: the turn ran out of tokens or wandered.
    // One nudge, then it is a budget failure.
    if (nudged) return done(final ? 'budget' : 'invalid', null, response.incomplete_details?.reason ?? response.status ?? undefined);
    input = [{ role: 'user', content: FINAL_NUDGE }];
    nudged = true;
  }
  return done('budget', null, 'turns exhausted');
}
