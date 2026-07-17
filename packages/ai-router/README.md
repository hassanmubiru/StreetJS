# @streetjs/ai-router

A **model registry** plus a **routing AI provider** for StreetJS. `AiRouter`
implements the `@streetjs/ai` `AiProvider` contract (`chat`/`embed`/`transcribe`)
and selects among several providers — by the request's model, by preference
order, or by cost — with automatic fallback on failure. ESM.

## Install

```bash
npm install @streetjs/ai-router @streetjs/ai
```

## Usage

```ts
import { AiRouter, ModelRegistry } from '@streetjs/ai-router';
import { OpenAiProvider, OllamaProvider } from '@streetjs/ai/providers';

const registry = new ModelRegistry([
  { id: 'gpt-4o-mini', provider: 'openai', capabilities: ['chat', 'embed'], costPer1kInput: 0.15, costPer1kOutput: 0.6 },
  { id: 'llama3',      provider: 'ollama', capabilities: ['chat', 'embed'], costPer1kInput: 0, costPer1kOutput: 0 },
]);

const ai = new AiRouter({
  providers: [
    { name: 'openai', provider: new OpenAiProvider() },
    { name: 'ollama', provider: new OllamaProvider() },
  ],
  registry,
  strategy: 'cheapest', // or 'ordered' (default)
  fallback: true,
});

// Because AiRouter *is* an AiProvider, it drops into RagPipeline/ChatSession too.
await ai.chat({ messages: [{ role: 'user', content: 'hi' }] });        // cheapest first
await ai.chat({ messages: [{ role: 'user', content: 'hi' }], model: 'llama3' }); // pinned → ollama
await ai.embed({ input: ['text'] });
await ai.transcribe({ audio });                                        // only capable providers
```

## Routing

For each call the router builds a provider order and tries them in turn:

1. **Pinned model** — if `request.model` is in the registry, its provider is
   tried first.
2. **Strategy** — `ordered` uses the provider list order; `cheapest` puts the
   provider of the registry's cheapest model (for that capability) first.
3. **Fallback** — on error it moves to the next provider (unless `fallback:
   false`). If all fail it throws `AiRoutingError` with the collected `causes`.

`transcribe` automatically skips providers that don't implement it.

## ModelRegistry

Records model metadata and answers routing/cost questions:

```ts
registry.register({ id, provider, capabilities, costPer1kInput?, costPer1kOutput?, contextWindow? });
registry.get(id);
registry.providerFor(id);
registry.list('chat');       // models supporting a capability
registry.cheapest('embed');  // lowest summed cost (priced models preferred)
```

## Example

A complete runnable example (offline, using the fake provider) lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/ai-router
```

## License

MIT — see [LICENSE](./LICENSE).
