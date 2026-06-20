<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/ai

Official StreetJS Framework AI module: a **provider-agnostic** surface for LLM
chat, embeddings, retrieval-augmented generation (RAG), and tool calling.

- One `AiProvider` contract; swap implementations freely
- Adapters: `OpenAiProvider`, `AnthropicProvider`, `OllamaProvider`
- `FakeAiProvider` — deterministic, network-free; default for tests/offline dev
- `RagPipeline` — embed → store → retrieve → answer (with `InMemoryVectorStore`)
- `ChatSession` — a tool-calling loop (model requests tools, you run handlers)

## Install

```bash
npm install @streetjs/ai
```

## Chat

```ts
import { OpenAiProvider } from '@streetjs/ai';

const ai = new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY });
const res = await ai.chat({ messages: [{ role: 'user', content: 'Hello!' }] });
console.log(res.message.content, res.usage);
```

Swap providers without touching call sites:

```ts
import { AnthropicProvider, OllamaProvider } from '@streetjs/ai';
const claude = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const local  = new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434' });
```

## Embeddings + RAG

```ts
import { RagPipeline, OpenAiProvider } from '@streetjs/ai';

const rag = new RagPipeline({ provider: new OpenAiProvider({ apiKey }), topK: 4 });
await rag.index([
  { id: 'd1', text: 'The Eiffel Tower is in Paris.' },
  { id: 'd2', text: 'Mount Everest is the tallest mountain.' },
]);
const { answer, context } = await rag.answer('Where is the Eiffel Tower?');
```

## Tool calling

```ts
import { ChatSession, OpenAiProvider } from '@streetjs/ai';

const session = new ChatSession({
  provider: new OpenAiProvider({ apiKey }),
  system: 'You can do arithmetic.',
  tools: [{
    name: 'add',
    description: 'Add two numbers',
    parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } },
    handler: ({ a, b }) => Number(a) + Number(b),
  }],
});

const { message, toolCallsExecuted } = await session.send('what is 2 + 3?');
// session runs the tool, feeds the result back, and returns the final answer
```

## Testing without network

`FakeAiProvider` is deterministic and offline. Its embeddings are hashed
bag-of-words vectors, so lexically similar text scores higher — enough to
exercise RAG end-to-end in tests. The HTTP adapters accept an injectable
`fetch`, so request/response handling is unit-tested without real API calls.

```ts
import { FakeAiProvider, RagPipeline } from '@streetjs/ai';
const rag = new RagPipeline({ provider: new FakeAiProvider() });
```

## API

- Providers: `OpenAiProvider`, `AnthropicProvider`, `OllamaProvider`, `FakeAiProvider`
- `RagPipeline` (`index`, `retrieve`, `answer`), `InMemoryVectorStore`, `cosineSimilarity`, `hashEmbedding`
- `ChatSession` (`send`, `messages`)
- Types: `AiProvider`, `ChatRequest/Response`, `ChatMessage`, `ToolCall`, `ToolDefinition`, `EmbedRequest/Response`

## Notes

- `AnthropicProvider` does not support embeddings (use OpenAI or Ollama).
- Tool-call wiring is implemented for the OpenAI adapter; Anthropic/Ollama
  adapters cover chat + (Ollama) embeddings. Function-calling for those is a
  tracked follow-up.

## Testing

```bash
npm run test -w packages/ai     # unit + property tests, fully offline
```

## License

MIT
