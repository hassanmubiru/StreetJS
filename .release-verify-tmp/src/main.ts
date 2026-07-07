// examples/01-rest-api/src/main.ts
// Complete REST API example with Street Framework

import 'reflect-metadata';
import { streetApp, defineConfig } from '@streetjs/core';

const config = defineConfig({
  PORT: { type: 'port', default: 3000 },
});

const app = streetApp({ port: config.PORT as number });

// In-memory store for demo
const items: Array<{ id: string; name: string; createdAt: string }> = [];

// GET /api/items
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/api/items') {
    ctx.json({ data: items, total: items.length });
    return;
  }

  // POST /api/items
  if (ctx.method === 'POST' && ctx.path === '/api/items') {
    const body = ctx.body as { name?: string };
    if (!body?.name) {
      ctx.json({ error: 'name is required' }, 400);
      return;
    }
    const item = { id: crypto.randomUUID(), name: body.name, createdAt: new Date().toISOString() };
    items.push(item);
    ctx.json({ data: item }, 201);
    return;
  }

  await next();
});

app.listen(config.PORT as number, '0.0.0.0').then(() => {
  console.log(`🚀 REST API running on http://localhost:${config.PORT}`);
});
