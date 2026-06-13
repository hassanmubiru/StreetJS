// AI Assistant — StreetJS reference application.
//
// A retrieval-augmented (RAG) assistant backend over @streetjs/ai. Indexes a
// knowledge base, answers questions grounded in retrieved context, and supports
// tool-calling. Uses the deterministic FakeAiProvider by default (offline,
// reproducible); set OPENAI_API_KEY to use a real model.
//
// Exposes a small HTTP API and is exported as createAssistant() for embedding.

import { createServer as createHttp } from 'node:http';
import { RagPipeline, FakeAiProvider, ChatSession, OpenAiProvider } from '@streetjs/ai';

export function createAssistant(opts = {}) {
  const provider = opts.provider ?? (process.env.OPENAI_API_KEY
    ? new OpenAiProvider({ apiKey: process.env.OPENAI_API_KEY })
    : new FakeAiProvider());
  const rag = new RagPipeline({ provider, topK: opts.topK ?? 3 });

  const service = {
    provider,
    rag,
    /** Index knowledge-base documents. */
    async ingest(docs) { await rag.index(docs); return { indexed: docs.length }; },
    /** Answer a question grounded in retrieved context. */
    async ask(question) {
      const { answer, context } = await rag.answer(question);
      return { answer, sources: context.map((c) => ({ id: c.record.id, score: Number(c.score.toFixed(4)) })) };
    },
    /** Run a tool-calling session (caller supplies tools). */
    newSession(tools = [], system) { return new ChatSession({ provider, tools, system }); },
  };

  const http = createHttp(async (req, res) => {
    try {
      if (req.url === '/health/live') return json(res, 200, { status: 'ok' });
      if (req.url === '/health/ready') return json(res, 200, { status: 'ok' });
      if (req.method === 'POST' && req.url === '/ingest') {
        const body = await readJson(req);
        return json(res, 200, await service.ingest(body.documents ?? []));
      }
      if (req.method === 'POST' && req.url === '/ask') {
        const body = await readJson(req);
        if (!body.question) return json(res, 400, { error: 'question required' });
        return json(res, 200, await service.ask(body.question));
      }
      json(res, 404, { error: 'not found' });
    } catch (err) {
      json(res, 500, { error: String(err?.message ?? err) });
    }
  });

  return {
    ...service,
    http,
    listen(port = 0) { return new Promise((r) => http.listen(port, () => r(http.address().port))); },
    close() { return new Promise((r) => http.close(r)); },
  };
}

function json(res, code, body) { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }
function readJson(req) {
  return new Promise((resolve, reject) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createAssistant();
  const port = await app.listen(Number(process.env.PORT) || 3000);
  console.log(`[ai-assistant] listening on http://0.0.0.0:${port} (provider: ${app.provider.name})`);
}
