---
layout:      default
title:       "AI"
permalink:   /ai/
nav_exclude: true
description:  "Build AI features with StreetJS — @streetjs/ai is a provider-agnostic surface for LLM chat, embeddings, retrieval-augmented generation (RAG), and tool calling, with OpenAI, Anthropic, and Ollama adapters plus a deterministic in-memory provider for tests."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Capability</span>
<h1>AI</h1>
<p><code>@streetjs/ai</code> is a provider-agnostic module for LLM chat, embeddings, retrieval-augmented generation (RAG), and tool calling. Write against one contract and swap OpenAI, Anthropic, or a local Ollama model without touching call sites — and test with a deterministic, network-free provider.</p>
</div>

<style>
.cap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin:24px 0}
.cap-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--border);background:var(--elevated);border-radius:14px;padding:20px}
.cap-card h3{margin:0;font-size:16px}
.cap-card p{margin:0;color:var(--text-secondary);font-size:14px;line-height:1.6}
.cap-note{border:1px solid var(--border);background:var(--elevated);border-radius:12px;padding:16px 18px;color:var(--text-secondary);margin:22px 0}
</style>

## What's included

<div class="cap-grid">

<div class="cap-card">
<h3>Provider-agnostic chat</h3>
<p>One <code>AiProvider</code> contract. Adapters for <code>OpenAiProvider</code>, <code>AnthropicProvider</code>, and <code>OllamaProvider</code> swap freely.</p>
</div>

<div class="cap-card">
<h3>Embeddings &amp; RAG</h3>
<p><code>RagPipeline</code> handles embed → store → retrieve → answer, with a built-in <code>InMemoryVectorStore</code>.</p>
</div>

<div class="cap-card">
<h3>Tool calling</h3>
<p><code>ChatSession</code> runs the tool-calling loop: the model requests a tool, your handler runs, and the result is fed back automatically.</p>
</div>

<div class="cap-card">
<h3>Deterministic tests</h3>
<p><code>FakeAiProvider</code> is network-free and deterministic — the default for tests and offline development.</p>
</div>

</div>

## Chat

```ts
import { OpenAiProvider } from '@streetjs/ai';

const ai = new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY });
const res = await ai.chat({ messages: [{ role: 'user', content: 'Hello!' }] });
console.log(res.message.content, res.usage);
```

Swap providers without changing the call site:

```ts
import { AnthropicProvider, OllamaProvider } from '@streetjs/ai';

const claude = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const local  = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434' });
```

## Retrieval-augmented generation

```ts
import { RagPipeline, OpenAiProvider } from '@streetjs/ai';

const rag = new RagPipeline({ provider: new OpenAiProvider({ apiKey }), topK: 4 });
await rag.index([
  { id: 'd1', text: 'The Eiffel Tower is in Paris.' },
  { id: 'd2', text: 'Mount Everest is the tallest mountain.' },
]);
const { answer, context } = await rag.answer('Where is the Eiffel Tower?');
```

## Install

```bash
npm install @streetjs/ai
```

<div class="cap-note">
Pair AI with the rest of the framework: run inference off the request path with <a href="{{ '/jobs/' | relative_url }}">background jobs</a>, stream responses to clients over <a href="{{ '/realtime/' | relative_url }}">realtime channels</a>, and store embeddings alongside your application data using the <a href="{{ '/database/' | relative_url }}">PostgreSQL driver</a>. The <a href="https://www.npmjs.com/package/@streetjs/plugin-openai">OpenAI plugin</a> wires provider configuration into your app.
</div>

## Next steps

- Install [`@streetjs/ai`](https://www.npmjs.com/package/@streetjs/ai)
- Schedule inference with [background jobs]({{ '/jobs/' | relative_url }})
- Stream results over [realtime channels]({{ '/realtime/' | relative_url }})
