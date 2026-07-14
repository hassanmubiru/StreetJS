/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Uses an injected fake fetch (no network) to demonstrate base URLs, JSON
 * bodies, query params, an auth interceptor, and retry-then-succeed on 503.
 */

import { createHttpClient, type FetchLike } from '../index.js';

function scriptedFetch(): FetchLike {
  let flakyHits = 0;
  return async (url, init) => {
    process.stdout.write(`→ ${String(init.method)} ${url}\n`);
    if (url.endsWith('/flaky')) {
      flakyHits++;
      if (flakyHits < 2) {
        return new Response('{}', { status: 503 }); // first attempt fails, retry succeeds
      }
    }
    if (url.includes('/users') && init.method === 'POST') {
      return new Response(JSON.stringify({ id: 42, name: 'Ada' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

async function main(): Promise<void> {
  const api = createHttpClient({
    baseUrl: 'https://api.example.com/v1',
    fetch: scriptedFetch(),
    sleep: async () => {}, // no real backoff waits in the example
    retry: { retries: 3, jitter: false },
    onRequest: [
      (req) => {
        req.headers['authorization'] = 'Bearer example-token';
        return req;
      },
    ],
  });

  const list = await api.get('/users', { query: { page: 1, active: true } });
  process.stdout.write(`GET /users -> ${list.status}, ${JSON.stringify(list.json())}\n`);

  const created = await api.post('/users', { name: 'Ada' });
  process.stdout.write(`POST /users -> ${created.status}, ${JSON.stringify(created.json())}\n`);

  const flaky = await api.get('/flaky'); // 503 then 200
  process.stdout.write(`GET /flaky -> ${flaky.status} (after retry)\n`);
}

void main();
