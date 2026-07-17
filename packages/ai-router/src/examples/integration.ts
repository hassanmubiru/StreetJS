/**
 * @streetjs/ai-router — runnable integration example.
 *
 * Registers two models on two providers and shows model-pinned routing,
 * cost-aware selection, and automatic fallback — all offline using the
 * deterministic FakeAiProvider plus a deliberately-failing provider.
 *
 * Run with: `npm run example -w packages/ai-router`
 */

import { FakeAiProvider, type AiProvider, type ChatResponse } from '@streetjs/ai';
import { AiRouter, ModelRegistry } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

class DownProvider implements AiProvider {
  readonly name = 'down';
  async chat(): Promise<ChatResponse> { throw new Error('primary offline'); }
  async embed(): Promise<never> { throw new Error('primary offline'); }
}

const registry = new ModelRegistry([
  { id: 'gpt-4o-mini', provider: 'openai', capabilities: ['chat', 'embed'], costPer1kInput: 0.15, costPer1kOutput: 0.6 },
  { id: 'llama3', provider: 'ollama', capabilities: ['chat', 'embed'], costPer1kInput: 0, costPer1kOutput: 0 },
]);

// "openai" is down; "ollama" is our deterministic fake that always answers.
const router = new AiRouter({
  providers: [
    { name: 'openai', provider: new DownProvider() },
    { name: 'ollama', provider: new FakeAiProvider() },
  ],
  registry,
  strategy: 'cheapest',
  fallback: true,
});

// 1. Cheapest routing prefers the free llama3 (ollama) — which is also up.
const res = await router.chat({ messages: [{ role: 'user', content: 'hello' }] });
console.log('chat answered:', res.message.content);
assert(res.message.content.startsWith('echo:'), 'answered by the fake (ollama)');

// 2. Even pinning the down provider’s model falls back to a working one.
const pinned = await router.chat({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o-mini' });
assert(pinned.message.content.startsWith('echo:'), 'fell back past the down openai provider');
console.log('fallback answered:', pinned.message.content);

// 3. Cheapest chat model per the registry.
console.log('cheapest chat model:', registry.cheapest('chat')?.id);
assert(registry.cheapest('chat')?.id === 'llama3', 'llama3 is free → cheapest');

console.log('\nAll @streetjs/ai-router example assertions passed.');
