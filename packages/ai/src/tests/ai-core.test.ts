// ai-core.test.ts
// Unit tests for the fake provider, vector store, RAG pipeline, and tool loop.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FakeAiProvider,
  InMemoryVectorStore,
  RagPipeline,
  ChatSession,
  cosineSimilarity,
  hashEmbedding,
  type ChatRequest,
  type RegisteredTool,
} from '../index.js';

describe('FakeAiProvider', () => {
  it('chat echoes the last user message deterministically', async () => {
    const p = new FakeAiProvider();
    const r1 = await p.chat({ messages: [{ role: 'user', content: 'hello' }] });
    const r2 = await p.chat({ messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(r1.message.content, 'echo: hello');
    assert.deepEqual(r1, r2);
    assert.equal(r1.finishReason, 'stop');
  });

  it('embeddings are deterministic and overlap-sensitive', async () => {
    const p = new FakeAiProvider();
    const { embeddings } = await p.embed({ input: ['quick brown fox', 'quick brown dog', 'completely unrelated text'] });
    const simClose = cosineSimilarity(embeddings[0]!, embeddings[1]!);
    const simFar = cosineSimilarity(embeddings[0]!, embeddings[2]!);
    assert.ok(simClose > simFar, 'lexically closer texts must score higher');
    assert.equal(cosineSimilarity(embeddings[0]!, embeddings[0]!).toFixed(5), '1.00000');
  });
});

describe('cosineSimilarity', () => {
  it('handles zero vectors and dimension mismatch', () => {
    assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
    assert.throws(() => cosineSimilarity([1], [1, 2]), /dimension mismatch/);
  });
});

describe('InMemoryVectorStore', () => {
  it('returns top-k by similarity, score-desc', async () => {
    const store = new InMemoryVectorStore();
    await store.upsert({ id: 'a', text: 'cat', embedding: hashEmbedding('cat') });
    await store.upsert({ id: 'b', text: 'dog', embedding: hashEmbedding('dog') });
    await store.upsert({ id: 'c', text: 'cat cat', embedding: hashEmbedding('cat cat') });
    const hits = await store.query(hashEmbedding('cat'), 2);
    assert.equal(hits.length, 2);
    assert.ok(hits[0]!.score >= hits[1]!.score);
    assert.ok(hits.map((h) => h.record.id).includes('a'));
    assert.equal(await store.size(), 3);
    assert.equal(await store.remove('a'), true);
    assert.equal(await store.size(), 2);
  });
});

describe('RagPipeline', () => {
  it('retrieves the most relevant document and grounds the answer', async () => {
    const rag = new RagPipeline({ provider: new FakeAiProvider(), topK: 2 });
    await rag.index([
      { id: 'd1', text: 'The Eiffel Tower is located in Paris, France.' },
      { id: 'd2', text: 'Mount Everest is the tallest mountain on Earth.' },
      { id: 'd3', text: 'The Great Barrier Reef is off the coast of Australia.' },
    ]);
    const hits = await rag.retrieve('Where is the Eiffel Tower?', 1);
    assert.equal(hits[0]!.record.id, 'd1');

    const answer = await rag.answer('Where is the Eiffel Tower?');
    assert.equal(answer.context[0]!.record.id, 'd1');
    // The fake chat echoes the user query; the grounded context is what matters.
    assert.ok(answer.answer.includes('Eiffel Tower'));
  });

  it('requires a provider', () => {
    assert.throws(() => new RagPipeline({} as never), /provider is required/);
  });
});

describe('ChatSession tool-calling loop', () => {
  it('executes a requested tool and feeds the result back to the model', async () => {
    // Script: first turn requests the `add` tool; second turn returns the sum.
    let turn = 0;
    const provider = new FakeAiProvider({
      chatScript: (req: ChatRequest) => {
        turn++;
        if (turn === 1) {
          return {
            message: {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'call_1', name: 'add', arguments: { a: 2, b: 3 } }],
            },
            finishReason: 'tool_calls',
          };
        }
        // Second call: the tool result is the most recent `tool` message.
        const toolMsg = [...req.messages].reverse().find((m) => m.role === 'tool');
        return { message: { role: 'assistant', content: `The sum is ${toolMsg?.content}` }, finishReason: 'stop' };
      },
    });

    const add: RegisteredTool = {
      name: 'add',
      description: 'Add two numbers',
      parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
      handler: (args) => Number(args['a']) + Number(args['b']),
    };

    const session = new ChatSession({ provider, tools: [add], system: 'You can add numbers.' });
    const res = await session.send('what is 2 + 3?');
    assert.equal(res.toolCallsExecuted, 1);
    assert.equal(res.message.content, 'The sum is 5');
    // Transcript includes the tool result message.
    assert.ok(session.messages.some((m) => m.role === 'tool' && m.content === '5'));
  });

  it('reports tool errors back to the model instead of throwing', async () => {
    let turn = 0;
    const provider = new FakeAiProvider({
      chatScript: () => {
        turn++;
        if (turn === 1) {
          return {
            message: { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'boom', arguments: {} }] },
            finishReason: 'tool_calls',
          };
        }
        return { message: { role: 'assistant', content: 'handled' }, finishReason: 'stop' };
      },
    });
    const boom: RegisteredTool = {
      name: 'boom',
      description: 'always fails',
      parameters: {},
      handler: () => { throw new Error('kaboom'); },
    };
    const session = new ChatSession({ provider, tools: [boom] });
    const res = await session.send('go');
    assert.equal(res.message.content, 'handled');
    const toolMsg = session.messages.find((m) => m.role === 'tool');
    assert.match(toolMsg!.content, /kaboom/);
  });

  it('stops at maxIterations if the model never finalizes', async () => {
    const provider = new FakeAiProvider({
      chatScript: () => ({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'noop', arguments: {} }] },
        finishReason: 'tool_calls',
      }),
    });
    const noop: RegisteredTool = { name: 'noop', description: '', parameters: {}, handler: () => 'ok' };
    const session = new ChatSession({ provider, tools: [noop], maxIterations: 3 });
    const res = await session.send('loop');
    assert.equal(res.toolCallsExecuted, 3);
  });
});
