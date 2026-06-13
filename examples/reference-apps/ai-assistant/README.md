# AI Assistant — StreetJS reference application

A retrieval-augmented (RAG) assistant backend over `@streetjs/ai`: ingest a
knowledge base, answer questions grounded in retrieved context, and run
tool-calling sessions. Uses the deterministic `FakeAiProvider` by default
(offline, reproducible); set `OPENAI_API_KEY` to use a real model — no code change.

## Run

```bash
npm run build -w packages/ai
node examples/reference-apps/ai-assistant/server.mjs   # :3000
# POST /ingest {documents:[{id,text}]}   POST /ask {question}   GET /health/live
```

## Verification (executed)

```bash
node examples/reference-apps/ai-assistant/smoke-test.mjs   # 5/5 checks, exit 0
```

Covers: ingest, grounded answer, **retrieval surfaces the correct source**
(top hit matches the question), and a **tool-calling loop** that executes a tool
and feeds the result back.

## Security & production notes

- Swap `FakeAiProvider` → `OpenAiProvider`/`AnthropicProvider`/`OllamaProvider` via env
- Validate/rate-limit `/ask`; cap document and question sizes
- Persist embeddings in a real vector store for scale (the in-memory store is for
  single-instance / demo)

## Deployment & monitoring

Containerize with the repo `Dockerfile`; deploy via `deploy/`. Probe
`/health/live` + `/health/ready`. Track answer latency and token usage
(`ChatResponse.usage`).
