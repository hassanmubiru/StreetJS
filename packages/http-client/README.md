# @streetjs/http-client

The outbound HTTP client foundation for StreetJS: a **typed client over `fetch`** with
base URLs, query building, JSON helpers, timeouts, retries with backoff, request/response
interceptors, and descriptive errors.

**Zero runtime dependencies.** Uses the global `fetch` (Node ≥ 18), matching the StreetJS
minimal, carefully curated dependency footprint. Generic and reusable by any application.

```bash
npm install @streetjs/http-client
```

## Why

Packages and apps constantly call other services. `fetch` alone lacks base URLs, query
building, JSON ergonomics, timeouts, and retries — so everyone reinvents them.
`@streetjs/http-client` provides those consistently, with an **injectable `fetch` and
`sleep`** so it's fully testable without network access.

## Quick start

```ts
import { createHttpClient } from '@streetjs/http-client';

const api = createHttpClient({
  baseUrl: 'https://api.example.com/v1',
  headers: { accept: 'application/json' },
  timeoutMs: 5000,
});

const res = await api.get('/users', { query: { page: 2, tags: ['a', 'b'] } });
const users = res.json<User[]>();          // typed, buffered parse

await api.post('/users', { name: 'Ada' }); // object body → JSON + content-type
await api.put('/users/1', { name: 'Ada L.' });
await api.delete('/users/1');
```

## Requests & bodies

`request(method, path, options)` is the full-control entry point; `get`/`delete`/`head`/
`options` and `post`/`put`/`patch` (which take a body) are conveniences.

- Object bodies are JSON-encoded and get `content-type: application/json` (unless you set
  one). Use `{ json }` to force JSON explicitly.
- `string` / `Uint8Array` bodies pass through untouched.
- `query` is appended and URL-encoded (arrays repeat the key); existing query strings are
  preserved.

## Responses

`HttpResponse` buffers the body once, so reads are synchronous and repeatable:

```ts
res.status;      // number
res.ok;          // 2xx?
res.headers;     // plain lowercase map
res.text();      // string
res.json<T>();   // parsed (undefined for empty body)
res.bytes();     // Uint8Array
```

## Errors

By default a non-2xx response throws an `HttpError` (`kind: 'status'`) with the response
attached; network failures, timeouts, and aborts throw `HttpError` with
`kind: 'network' | 'timeout' | 'aborted'`. Set `throwOnError: false` (per client or per
request) to receive the response instead.

```ts
try {
  await api.get('/maybe');
} catch (err) {
  if (err instanceof HttpError && err.status === 404) { /* ... */ }
}
```

## Timeouts

Each request is bounded by `timeoutMs` (default 30s) via an `AbortController`; a caller
`signal` is combined with it. A timeout throws `HttpError` (`kind: 'timeout'`); a caller
abort throws `kind: 'aborted'` and is never retried.

## Retries

Retries are on by default for **idempotent** methods and standard retriable statuses:

```ts
createHttpClient({
  retry: {
    retries: 2,                                  // additional attempts
    methods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
    statuses: [408, 429, 500, 502, 503, 504],
    baseDelayMs: 100, maxDelayMs: 2000,          // exponential backoff
    jitter: true,
    respectRetryAfter: true,                     // honor Retry-After on 429/503
  },
});
```

Network errors and timeouts are also retried (for eligible methods). `POST`/`PATCH` are
not retried by default (non-idempotent); add them to `methods` if your endpoints are safe.

## Interceptors

```ts
createHttpClient({
  onRequest: [(req) => { req.headers['authorization'] = `Bearer ${token()}`; return req; }],
  onResponse: [(res, req) => { metrics.observe(req.method, res.status); }],
});
```

Request interceptors run before sending (and can replace the request); response
interceptors run before returning (and can replace the response).

## Testing

Inject a fake `fetch` and a no-op `sleep` for fast, deterministic, network-free tests:

```ts
const client = createHttpClient({
  fetch: async (url, init) => new Response('{"ok":true}', { status: 200 }),
  sleep: async () => {},
});
```

## Dependency injection

Depends on no container. Exports an `HTTP_CLIENT` token (a global `Symbol`):

```ts
import { HTTP_CLIENT, createHttpClient } from '@streetjs/http-client';
container.register(HTTP_CLIENT, createHttpClient({ baseUrl }));
```

## Public API

`createHttpClient` / `HttpClient` · `HttpResponse` · `HttpError` · retry helpers
(`DEFAULT_RETRY_POLICY`, `resolveRetryPolicy`, `isRetriableMethod`, `isRetriableStatus`,
`computeBackoff`, `parseRetryAfter`) · url helpers (`resolveUrl`, `appendQuery`,
`buildQueryString`, `isAbsoluteUrl`) · `HTTP_CLIENT` token · types.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module layout and design notes, and
`src/examples/integration.ts` for a runnable end-to-end example (network-free).

## License

MIT © street contributors
