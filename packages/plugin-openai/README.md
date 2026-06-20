<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-openai

Official StreetJS plugin: **OpenAI** chat completions + embeddings.

Dependency-free — request construction (bearer auth + JSON body) is pure and
offline-verifiable; the network send uses `node:https`. A configurable `baseUrl`
supports Azure OpenAI and OpenAI-compatible gateways.

## Install

```bash
npm install @streetjs/plugin-openai
# or: street add openai
```

## Configuration

```ts
import { OpenAiPlugin } from '@streetjs/plugin-openai';

const plugin = new OpenAiPlugin({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG,   // optional
  baseUrl: 'https://api.openai.com/v1',   // optional override
  stateKey: 'openai',
});
```

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `apiKey` | string | yes | bearer token |
| `organization` | string | no | `OpenAI-Organization` header |
| `baseUrl` | string | no | https override (Azure/compatible) |
| `stateKey` | string | no | request-state key (default `openai`) |

## Usage

```ts
import type { StreetContext } from 'streetjs';
import type { OpenAiClient } from '@streetjs/plugin-openai';

const ai = ctx.state['openai'] as OpenAiClient;
const res = await ai.chat({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

`buildChatRequest` / `buildEmbeddingsRequest` are exported as testable seams.

## Security

- **Permissions:** `net`, `secrets`, `middleware`. Ed25519-signed manifest verified on install.
- The API key is sent only as a bearer header to the configured base URL.
- No third-party runtime dependencies.

> For richer LLM workflows (RAG, tool-calling, multiple providers) see the
> in-framework `@streetjs/ai` package; this plugin is a focused OpenAI client.

## License

MIT
