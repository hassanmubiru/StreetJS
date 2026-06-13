// providers.test.ts
// Unit tests for the HTTP adapters using a stub fetch (no network). Verifies
// request shaping (URL, headers, body) and response parsing for each provider.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { OpenAiProvider, AnthropicProvider, OllamaProvider, type FetchLike } from '../providers.js';

/** Build a stub fetch that records the last call and returns a canned JSON body. */
function stubFetch(responseBody: unknown, ok = true, status = 200) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      async text() { return JSON.stringify(responseBody); },
      async json() { return responseBody; },
    };
  };
  return { fetch, calls };
}

describe('OpenAiProvider', () => {
  it('shapes a chat request and parses the assistant message + usage', async () => {
    const { fetch, calls } = stubFetch({
      choices: [{ message: { content: 'hi there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 2 },
    });
    const p = new OpenAiProvider({ apiKey: 'sk-test', fetch, defaultModel: 'gpt-4o-mini' });
    const res = await p.chat({ messages: [{ role: 'user', content: 'hi' }], temperature: 0.5 });

    assert.equal(calls[0]!.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(calls[0]!.init.headers['authorization'], 'Bearer sk-test');
    const body = JSON.parse(calls[0]!.init.body);
    assert.equal(body.model, 'gpt-4o-mini');
    assert.equal(body.temperature, 0.5);
    assert.equal(body.messages[0].content, 'hi');

    assert.equal(res.message.content, 'hi there');
    assert.equal(res.finishReason, 'stop');
    assert.deepEqual(res.usage, { promptTokens: 11, completionTokens: 2 });
  });

  it('parses tool calls and reports finishReason tool_calls', async () => {
    const { fetch } = stubFetch({
      choices: [{
        message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'getWeather', arguments: '{"city":"Paris"}' } }] },
        finish_reason: 'tool_calls',
      }],
    });
    const p = new OpenAiProvider({ apiKey: 'k', fetch });
    const res = await p.chat({
      messages: [{ role: 'user', content: 'weather?' }],
      tools: [{ name: 'getWeather', description: 'gets weather', parameters: { type: 'object' } }],
    });
    assert.equal(res.finishReason, 'tool_calls');
    assert.equal(res.message.toolCalls![0]!.name, 'getWeather');
    assert.deepEqual(res.message.toolCalls![0]!.arguments, { city: 'Paris' });
  });

  it('parses embeddings', async () => {
    const { fetch, calls } = stubFetch({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }], usage: { prompt_tokens: 4 } });
    const p = new OpenAiProvider({ apiKey: 'k', fetch });
    const res = await p.embed({ input: ['a', 'b'] });
    assert.equal(calls[0]!.url, 'https://api.openai.com/v1/embeddings');
    assert.deepEqual(res.embeddings, [[0.1, 0.2], [0.3, 0.4]]);
  });

  it('throws a descriptive error on non-ok responses', async () => {
    const { fetch } = stubFetch({ error: 'bad' }, false, 401);
    const p = new OpenAiProvider({ apiKey: 'k', fetch });
    await assert.rejects(() => p.chat({ messages: [{ role: 'user', content: 'x' }] }), /openai API error 401/);
  });
});

describe('AnthropicProvider', () => {
  it('hoists system messages and parses text blocks', async () => {
    const { fetch, calls } = stubFetch({
      content: [{ type: 'text', text: 'Bonjour' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const p = new AnthropicProvider({ apiKey: 'ak', fetch });
    const res = await p.chat({
      messages: [{ role: 'system', content: 'Be brief' }, { role: 'user', content: 'hi' }],
      maxTokens: 256,
    });
    assert.equal(calls[0]!.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(calls[0]!.init.headers['x-api-key'], 'ak');
    const body = JSON.parse(calls[0]!.init.body);
    assert.equal(body.system, 'Be brief');
    assert.equal(body.messages.length, 1); // system removed from turns
    assert.equal(res.message.content, 'Bonjour');
    assert.deepEqual(res.usage, { promptTokens: 5, completionTokens: 3 });
  });

  it('does not support embeddings', async () => {
    const p = new AnthropicProvider({ apiKey: 'ak', fetch: stubFetch({}).fetch });
    await assert.rejects(() => p.embed({ input: ['x'] }), /embeddings are not supported/);
  });
});

describe('OllamaProvider', () => {
  it('shapes a local chat request and parses the message', async () => {
    const { fetch, calls } = stubFetch({ message: { role: 'assistant', content: 'local reply' }, done: true, prompt_eval_count: 7, eval_count: 4 });
    const p = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', fetch, defaultModel: 'llama3' });
    const res = await p.chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(calls[0]!.url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(res.message.content, 'local reply');
    assert.equal(res.finishReason, 'stop');
    assert.deepEqual(res.usage, { promptTokens: 7, completionTokens: 4 });
  });

  it('parses embeddings one input at a time', async () => {
    const { fetch } = stubFetch({ embedding: [1, 2, 3] });
    const p = new OllamaProvider({ fetch });
    const res = await p.embed({ input: ['a', 'b'] });
    assert.deepEqual(res.embeddings, [[1, 2, 3], [1, 2, 3]]);
  });
});
