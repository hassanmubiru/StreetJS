// End-to-end smoke test for the AI Assistant reference app (deterministic,
// offline via FakeAiProvider).
//   node examples/reference-apps/ai-assistant/smoke-test.mjs

import assert from 'node:assert/strict';
import { createAssistant } from './server.mjs';

const app = createAssistant(); // FakeAiProvider (deterministic) unless OPENAI_API_KEY set

let failures = 0;
const check = (n, fn) => { try { fn(); console.log('  ok  ' + n); } catch (e) { failures++; console.log('  FAIL ' + n + ': ' + e.message); } };

// Ingest a small knowledge base.
const r = await app.ingest([
  { id: 'kb1', text: 'StreetJS is a TypeScript backend platform with a native PostgreSQL wire driver.' },
  { id: 'kb2', text: 'The ChannelHub provides realtime rooms, presence, and typing indicators.' },
  { id: 'kb3', text: 'The CommerceService guarantees no overselling via atomic stock reservation.' },
]);
check('ingest indexes documents', () => assert.equal(r.indexed, 3));

// Ask a question — retrieval should surface the relevant doc.
const a1 = await app.ask('What database driver does StreetJS use?');
check('answer returned', () => assert.ok(typeof a1.answer === 'string' && a1.answer.length > 0));
check('retrieval surfaces the PostgreSQL doc as top source', () => assert.equal(a1.sources[0].id, 'kb1'));

const a2 = await app.ask('How does it prevent overselling?');
check('commerce question retrieves the commerce doc', () => assert.equal(a2.sources[0].id, 'kb3'));

// Tool-calling session (deterministic scripted provider).
import { FakeAiProvider } from '@streetjs/ai';
let turn = 0;
const scripted = new FakeAiProvider({
  chatScript: (req) => {
    turn++;
    if (turn === 1) return { message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'now', arguments: {} }] }, finishReason: 'tool_calls' };
    const tool = [...req.messages].reverse().find((m) => m.role === 'tool');
    return { message: { role: 'assistant', content: `The value is ${tool?.content}` }, finishReason: 'stop' };
  },
});
const app2 = createAssistant({ provider: scripted });
const session = app2.newSession([{ name: 'now', description: 'returns 42', parameters: {}, handler: () => '42' }], 'You can call tools.');
const res = await session.send('use the tool');
check('tool-calling loop executes and answers', () => { assert.equal(res.toolCallsExecuted, 1); assert.equal(res.message.content, 'The value is 42'); });

console.log(failures === 0 ? '\n✅ ai-assistant reference app: all checks passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
