import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runToolLoop, type ParsedResponseLike, type ResponsesClient } from '../src/agent/loop.js';

/**
 * The tool loop against a scripted client: what it sends back, what it counts,
 * and where it stops.
 */
const Final = z.object({ answer: z.string() });

function response(over: Partial<ParsedResponseLike> & { id: string }): ParsedResponseLike {
  return { status: 'completed', output: [], output_parsed: null, usage: { input_tokens: 10, output_tokens: 5 }, ...over };
}

function scripted(responses: ParsedResponseLike[]) {
  const calls: Record<string, unknown>[] = [];
  const client: ResponsesClient = {
    responses: {
      parse: async (body) => {
        calls.push(body);
        const next = responses.shift();
        if (!next) throw new Error('script exhausted');
        return next;
      },
    },
  };
  return { client, calls };
}

const echo = {
  name: 'echo',
  description: 'echo',
  parameters: z.object({ text: z.string() }),
  handler: async (args: { text: string }) => `echo:${args.text}`,
};

describe('the tool loop', () => {
  it('runs a function call, returns its output under previous_response_id, and takes the parsed answer', async () => {
    const { client, calls } = scripted([
      response({ id: 'r1', output: [{ type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"text":"hi"}' }] }),
      response({ id: 'r2', output_parsed: { answer: 'done' }, usage: { input_tokens: 20, output_tokens: 7, input_tokens_details: { cached_tokens: 15 } } }),
    ]);
    const out = await runToolLoop({ client, model: 'm', instructions: 'i', input: [{ role: 'user', content: 'q' }], tools: [echo], webSearch: true, finalSchema: Final, finalSchemaName: 'final' });

    expect(out.status).toBe('ok');
    expect(out.result).toEqual({ answer: 'done' });
    expect(calls[0]!.previous_response_id).toBeUndefined();
    expect(calls[1]!.previous_response_id).toBe('r1');
    expect(calls[1]!.input).toEqual([{ type: 'function_call_output', call_id: 'c1', output: 'echo:hi' }]);
    // Instructions are re-sent on every turn; they do not carry over.
    expect(calls[1]!.instructions).toBe('i');
    expect(out.turns[0]!.toolCalls[0]).toMatchObject({ name: 'echo', args: { text: 'hi' }, resultDigest: 'echo:hi' });
    expect(out.usage).toEqual({ input: 30, cached: 15, output: 12, reasoning: 0 });
    expect(out.responseIds).toEqual(['r1', 'r2']);
  });

  it('answers bad arguments and unknown tools with text rather than throwing', async () => {
    const { client, calls } = scripted([
      response({
        id: 'r1',
        output: [
          { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"nope":1}' },
          { type: 'function_call', call_id: 'c2', name: 'missing', arguments: '{}' },
        ],
      }),
      response({ id: 'r2', output_parsed: { answer: 'x' } }),
    ]);
    const out = await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [echo], webSearch: false, finalSchema: Final, finalSchemaName: 'final' });
    expect(out.status).toBe('ok');
    const outputs = calls[1]!.input as { output: string }[];
    expect(outputs[0]!.output).toMatch(/invalid arguments/);
    expect(outputs[1]!.output).toMatch(/not a tool/);
  });

  it('counts web searches, keeps their sources, and withdraws the tool at the cap', async () => {
    const search = { type: 'web_search_call', action: { type: 'search', query: 'what is HE3490LS', sources: [{ url: 'https://example.com/a' }] } };
    const { client, calls } = scripted([
      response({ id: 'r1', output: [search, { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"text":"a"}' }] }),
      response({ id: 'r2', output: [{ type: 'function_call', call_id: 'c2', name: 'echo', arguments: '{"text":"b"}' }] }),
      response({ id: 'r3', output_parsed: { answer: 'x' } }),
    ]);
    const out = await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [echo], webSearch: true, finalSchema: Final, finalSchemaName: 'final', budget: { maxWebSearches: 1 } });
    expect(out.status).toBe('ok');
    expect(out.turns[0]!.webSearches).toEqual([{ turn: 1, queries: ['what is HE3490LS'], urls: ['https://example.com/a'] }]);
    const hasWeb = (body: Record<string, unknown>) => (body.tools as { type: string }[]).some((t) => t.type === 'web_search');
    expect(hasWeb(calls[0]!)).toBe(true);
    expect(hasWeb(calls[1]!)).toBe(false);
  });

  it('withdraws a tool once its own call cap is spent', async () => {
    const once = { ...echo, maxCalls: 1 };
    const { client, calls } = scripted([
      response({ id: 'r1', output: [{ type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"text":"a"}' }] }),
      response({ id: 'r2', output_parsed: { answer: 'x' } }),
    ]);
    await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [once], webSearch: false, finalSchema: Final, finalSchemaName: 'final' });
    expect((calls[0]!.tools as unknown[]).length).toBe(1);
    expect((calls[1]!.tools as unknown[]).length).toBe(0);
  });

  it('runs only as many calls as the budget has left when one response asks for more', async () => {
    let ran = 0;
    const counted = { ...echo, handler: async (args: { text: string }) => (ran++, `echo:${args.text}`) };
    const many = Array.from({ length: 5 }, (_, i) => ({ type: 'function_call', call_id: `c${i}`, name: 'echo', arguments: `{"text":"${i}"}` }));
    const { client, calls } = scripted([
      response({ id: 'r1', output: many }),
      response({ id: 'r2', output_parsed: { answer: 'x' } }),
    ]);
    const out = await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [counted], webSearch: false, finalSchema: Final, finalSchemaName: 'final', budget: { maxToolCalls: 3 } });
    expect(ran).toBe(3);
    // Every call is answered, in order, the refused ones without running.
    // The final nudge follows them, because the budget is now spent.
    const outputs = (calls[1]!.input as { type?: string; call_id: string; output: string }[]).filter((o) => o.type === 'function_call_output');
    expect(outputs.map((o) => o.call_id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(outputs.slice(0, 3).map((o) => o.output)).toEqual(['echo:0', 'echo:1', 'echo:2']);
    for (const o of outputs.slice(3)) expect(o.output).toMatch(/not run: the run's tool-call budget \(3\) is spent/);
    expect(out.turns[0]!.toolCalls.filter((t) => t.error)).toHaveLength(2);
    // The budget is spent, so the next turn is the forced final one.
    expect(calls[1]!.tools).toEqual([]);
  });

  it('holds a tool to its own cap within a single response', async () => {
    let ran = 0;
    const once = { ...echo, maxCalls: 1, handler: async (args: { text: string }) => (ran++, `echo:${args.text}`) };
    const { client, calls } = scripted([
      response({
        id: 'r1',
        output: [
          { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"text":"a"}' },
          { type: 'function_call', call_id: 'c2', name: 'echo', arguments: '{"text":"b"}' },
        ],
      }),
      response({ id: 'r2', output_parsed: { answer: 'x' } }),
    ]);
    await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [once], webSearch: false, finalSchema: Final, finalSchemaName: 'final' });
    expect(ran).toBe(1);
    const outputs = calls[1]!.input as { output: string }[];
    expect(outputs[1]!.output).toMatch(/"echo" has used its 1 calls/);
  });

  it('caps the searches a single response may run at what the budget has left', async () => {
    const search = { type: 'web_search_call', action: { type: 'search', query: 'q', sources: [] } };
    const { client, calls } = scripted([
      response({ id: 'r1', output: [search, { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"text":"a"}' }] }),
      response({ id: 'r2', output: [search, search, { type: 'function_call', call_id: 'c2', name: 'echo', arguments: '{"text":"b"}' }] }),
      response({ id: 'r3', output_parsed: { answer: 'x' } }),
    ]);
    const out = await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [echo], webSearch: true, finalSchema: Final, finalSchemaName: 'final', budget: { maxWebSearches: 2 } });
    expect(calls[0]!.max_tool_calls).toBe(2);
    expect(calls[1]!.max_tool_calls).toBe(1);
    // A response that searched past the cap anyway is recorded, and search is withdrawn.
    expect(out.turns[1]!.overBudget).toBe('web searches 3 of 2');
    expect(calls[2]!.max_tool_calls).toBeUndefined();
    expect((calls[2]!.tools as { type: string }[]).some((t) => t.type === 'web_search')).toBe(false);
  });

  it('sends no search cap when the run has no web search', async () => {
    const { client, calls } = scripted([response({ id: 'r1', output_parsed: { answer: 'x' } })]);
    await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [echo], webSearch: false, finalSchema: Final, finalSchemaName: 'final' });
    expect(calls[0]!.max_tool_calls).toBeUndefined();
  });

  it('forces a final turn with no tools when the turns are spent, and fails on budget if none comes', async () => {
    const call = (id: string) => response({ id, output: [{ type: 'function_call', call_id: `c${id}`, name: 'echo', arguments: '{"text":"a"}' }] });
    const { client, calls } = scripted([call('r1'), call('r2'), response({ id: 'r3', output: [] })]);
    const out = await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [echo], webSearch: true, finalSchema: Final, finalSchemaName: 'final', budget: { maxTurns: 2 } });
    expect(out.status).toBe('budget');
    expect(calls).toHaveLength(3);
    expect(calls[2]!.tools).toEqual([]);
    const last = calls[2]!.input as { type?: string; role?: string; content?: string }[];
    expect(last[0]!.type).toBe('function_call_output');
    expect(last[1]!.role).toBe('user');
    expect(last[1]!.content).toMatch(/final answer/);
    expect(calls[2]!.max_output_tokens).toBe(12_000);
  });

  it('nudges once when a turn produces neither an answer nor a call', async () => {
    const { client, calls } = scripted([
      response({ id: 'r1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }),
      response({ id: 'r2', output_parsed: { answer: 'late' } }),
    ]);
    const out = await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [echo], webSearch: false, finalSchema: Final, finalSchemaName: 'final' });
    expect(out.status).toBe('ok');
    expect((calls[1]!.input as { role: string }[])[0]!.role).toBe('user');
  });

  it('reports a transport failure as an error, not a throw', async () => {
    const client: ResponsesClient = { responses: { parse: async () => { throw new Error('boom'); } } };
    const out = await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [], webSearch: false, finalSchema: Final, finalSchemaName: 'final' });
    expect(out.status).toBe('error');
    expect(out.error).toBe('boom');
  });

  it('refuses an answer that does not fit the final schema', async () => {
    const { client } = scripted([response({ id: 'r1', output_parsed: { wrong: 1 } })]);
    const out = await runToolLoop({ client, model: 'm', instructions: 'i', input: [], tools: [], webSearch: false, finalSchema: Final, finalSchemaName: 'final' });
    expect(out.status).toBe('invalid');
  });
});
