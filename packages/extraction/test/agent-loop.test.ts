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
