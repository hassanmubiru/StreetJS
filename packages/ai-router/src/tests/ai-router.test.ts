import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FakeAiProvider, type AiProvider, type ChatRequest, type ChatResponse } from '@streetjs/ai';
import { AiRouter, AiRoutingError, ModelRegistry } from '../index.js';

const enc = (s: string) => new TextEncoder().encode(s);

/** A provider that always throws, tracking whether it was called. */
class FailingProvider implements AiProvider {
  called = 0;
  constructor(readonly name = 'failing') {}
  async chat(): Promise<ChatResponse> { this.called++; throw new Error(`${this.name} chat down`); }
  async embed(): Promise<never> { this.called++; throw new Error(`${this.name} embed down`); }
  async transcribe(): Promise<never> { this.called++; throw new Error(`${this.name} transcribe down`); }
}

/** A provider that tags its chat output so we can see who answered. */
class TaggedProvider implements AiProvider {
  constructor(readonly name: string) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    return { message: { role: 'assistant', content: `${this.name}:${req.messages.at(-1)?.content ?? ''}` }, finishReason: 'stop' };
  }
  async embed(): Promise<never> { throw new Error('no embed'); }
}

const chatReq = (content: string, model?: string): ChatRequest =>
  ({ messages: [{ role: 'user', content }], ...(model ? { model } : {}) });

// ── ModelRegistry ────────────────────────────────────────────────────────────

test('ModelRegistry registers, looks up, and maps model → provider', () => {
  const reg = new ModelRegistry([
    { id: 'gpt-4o-mini', provider: 'openai', capabilities: ['chat', 'embed'], costPer1kInput: 0.15 },
  ]);
  reg.register({ id: 'llama3', provider: 'ollama', capabilities: ['chat'], costPer1kInput: 0 });
  assert.equal(reg.get('gpt-4o-mini')?.provider, 'openai');
  assert.equal(reg.providerFor('llama3'), 'ollama');
  assert.equal(reg.providerFor('unknown'), undefined);
  assert.equal(reg.list().length, 2);
  assert.equal(reg.list('embed').length, 1);
});

test('ModelRegistry.register validates required fields', () => {
  const reg = new ModelRegistry();
  assert.throws(() => reg.register({ id: '', provider: 'p', capabilities: ['chat'] }), /id is required/);
  assert.throws(() => reg.register({ id: 'm', provider: '', capabilities: ['chat'] }), /provider is required/);
  assert.throws(() => reg.register({ id: 'm', provider: 'p', capabilities: [] }), /capability/);
});

test('ModelRegistry.cheapest ranks by summed cost, prefers priced models, breaks ties by id', () => {
  const reg = new ModelRegistry([
    { id: 'pricey', provider: 'a', capabilities: ['chat'], costPer1kInput: 5, costPer1kOutput: 10 },
    { id: 'cheap', provider: 'b', capabilities: ['chat'], costPer1kInput: 0.1, costPer1kOutput: 0.2 },
    { id: 'unpriced', provider: 'c', capabilities: ['chat'] },
  ]);
  assert.equal(reg.cheapest('chat')?.id, 'cheap');
  assert.equal(reg.cheapest('embed'), undefined);
});

// ── AiRouter basics ────────────────────────────────────────────────────────────

test('AiRouter requires at least one provider', () => {
  assert.throws(() => new AiRouter({ providers: [] }), AiRoutingError);
});

test('chat routes to the pinned model’s provider via the registry', async () => {
  const registry = new ModelRegistry([
    { id: 'gpt', provider: 'openai', capabilities: ['chat'] },
    { id: 'llama3', provider: 'ollama', capabilities: ['chat'] },
  ]);
  const router = new AiRouter({
    providers: [
      { name: 'openai', provider: new TaggedProvider('openai') },
      { name: 'ollama', provider: new TaggedProvider('ollama') },
    ],
    registry,
  });
  const res = await router.chat(chatReq('hi', 'llama3'));
  assert.equal(res.message.content, 'ollama:hi', 'routed to the provider serving llama3');
});

test('ordered strategy uses the first provider when no model is pinned', async () => {
  const router = new AiRouter({
    providers: [
      { name: 'primary', provider: new TaggedProvider('primary') },
      { name: 'secondary', provider: new TaggedProvider('secondary') },
    ],
  });
  const res = await router.chat(chatReq('yo'));
  assert.equal(res.message.content, 'primary:yo');
});

// ── Fallback ────────────────────────────────────────────────────────────────────

test('fallback tries the next provider when the first fails', async () => {
  const failing = new FailingProvider('openai');
  const router = new AiRouter({
    providers: [
      { name: 'openai', provider: failing },
      { name: 'ollama', provider: new TaggedProvider('ollama') },
    ],
  });
  const res = await router.chat(chatReq('hey'));
  assert.equal(failing.called, 1, 'first provider attempted');
  assert.equal(res.message.content, 'ollama:hey', 'fell back to the second');
});

test('when all providers fail, AiRoutingError carries the causes', async () => {
  const router = new AiRouter({
    providers: [
      { name: 'a', provider: new FailingProvider('a') },
      { name: 'b', provider: new FailingProvider('b') },
    ],
  });
  await assert.rejects(() => router.chat(chatReq('x')), (err: unknown) => {
    assert.ok(err instanceof AiRoutingError);
    assert.equal((err as AiRoutingError).causes.length, 2);
    assert.match((err as Error).message, /a chat down; b chat down/);
    return true;
  });
});

test('fallback disabled tries only the first provider', async () => {
  const first = new FailingProvider('a');
  const second = new FailingProvider('b');
  const router = new AiRouter({
    providers: [{ name: 'a', provider: first }, { name: 'b', provider: second }],
    fallback: false,
  });
  await assert.rejects(() => router.chat(chatReq('x')), AiRoutingError);
  assert.equal(first.called, 1);
  assert.equal(second.called, 0, 'no fallback attempted');
});

// ── Cheapest strategy ───────────────────────────────────────────────────────────

test('cheapest strategy tries the cheapest model’s provider first', async () => {
  const registry = new ModelRegistry([
    { id: 'exp', provider: 'openai', capabilities: ['chat'], costPer1kInput: 5 },
    { id: 'cheap', provider: 'ollama', capabilities: ['chat'], costPer1kInput: 0 },
  ]);
  const router = new AiRouter({
    providers: [
      { name: 'openai', provider: new TaggedProvider('openai') },
      { name: 'ollama', provider: new TaggedProvider('ollama') },
    ],
    registry,
    strategy: 'cheapest',
  });
  const res = await router.chat(chatReq('q'));
  assert.equal(res.message.content, 'ollama:q', 'cheapest provider chosen first');
});

// ── embed + transcribe ──────────────────────────────────────────────────────────

test('embed routes and falls back across providers', async () => {
  const router = new AiRouter({
    providers: [
      { name: 'broken', provider: new FailingProvider('broken') },
      { name: 'fake', provider: new FakeAiProvider() },
    ],
  });
  const res = await router.embed({ input: ['hello'] });
  assert.equal(res.embeddings.length, 1);
});

test('transcribe skips providers without transcription and uses one that has it', async () => {
  // TaggedProvider has no `transcribe`; FakeAiProvider does.
  const router = new AiRouter({
    providers: [
      { name: 'noaudio', provider: new TaggedProvider('noaudio') },
      { name: 'fake', provider: new FakeAiProvider() },
    ],
  });
  const res = await router.transcribe({ audio: enc('spoken words') });
  assert.equal(res.text, 'spoken words', 'transcription served by the capable provider');
});

test('candidateOrder de-dupes and ignores unregistered/unknown providers', async () => {
  // Registry points a model at a provider that is NOT registered on the router;
  // routing must skip it and fall through to the registered providers.
  const registry = new ModelRegistry([{ id: 'ghost-model', provider: 'ghost', capabilities: ['chat'] }]);
  const router = new AiRouter({
    providers: [{ name: 'real', provider: new TaggedProvider('real') }],
    registry,
  });
  const res = await router.chat(chatReq('ping', 'ghost-model'));
  assert.equal(res.message.content, 'real:ping');
});
