// Runnable example: chat, RAG, and tool-calling with the deterministic
// FakeAiProvider (no API keys, no network).
//
//   npm run example -w packages/ai
//
// Swap `new FakeAiProvider()` for `new OpenAiProvider({ apiKey })` (or
// Anthropic/Ollama) to run against a real model.

import { FakeAiProvider, RagPipeline, ChatSession } from '@streetjs/ai';

const provider = new FakeAiProvider();

// 1) Plain chat.
const chat = await provider.chat({ messages: [{ role: 'user', content: 'hello world' }] });
console.log('chat ->', chat.message.content);

// 2) RAG: index documents, then answer grounded in retrieval.
const rag = new RagPipeline({ provider, topK: 2 });
await rag.index([
  { id: 'd1', text: 'The Eiffel Tower is located in Paris, France.' },
  { id: 'd2', text: 'Mount Everest is the tallest mountain on Earth.' },
  { id: 'd3', text: 'The Great Barrier Reef lies off the coast of Australia.' },
]);
const retrieved = await rag.retrieve('Where is the Eiffel Tower?', 1);
console.log('\nRAG retrieved ->', retrieved[0].record.id, `(score ${retrieved[0].score.toFixed(3)})`);
const answer = await rag.answer('Where is the Eiffel Tower?');
console.log('RAG context docs ->', answer.context.map((c) => c.record.id));

// 3) Tool calling: a scripted model that asks for `add`, then answers.
let turn = 0;
const scripted = new FakeAiProvider({
  chatScript: (req) => {
    turn++;
    if (turn === 1) {
      return {
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'add', arguments: { a: 2, b: 3 } }] },
        finishReason: 'tool_calls',
      };
    }
    const toolMsg = [...req.messages].reverse().find((m) => m.role === 'tool');
    return { message: { role: 'assistant', content: `The sum is ${toolMsg?.content}` }, finishReason: 'stop' };
  },
});
const session = new ChatSession({
  provider: scripted,
  tools: [{
    name: 'add',
    description: 'Add two numbers',
    parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
    handler: ({ a, b }) => Number(a) + Number(b),
  }],
});
const result = await session.send('what is 2 + 3?');
console.log('\ntool-calling ->', result.message.content, `(tools executed: ${result.toolCallsExecuted})`);
