# @streetjs/http-client — Architecture

## Goals

- A single, generic outbound HTTP client every StreetJS package/app can build on.
- Zero runtime dependencies (global `fetch`); fully testable without network access.
- Strongly typed, interface-first; strict TypeScript; no circular dependencies.
- Sensible, safe defaults: idempotent-only retries, bounded timeouts, JSON ergonomics.

## Module layout

```
src/
  types.ts     Public interfaces: options, request, retry policy, interceptors, fetch.
  errors.ts    HttpError (kind: status | network | timeout | aborted).
  url.ts       Base/path resolution + query-string building.
  retry.ts     Default policy, retriability checks, backoff, Retry-After parsing.
  response.ts  HttpResponse: buffered body with text()/json()/bytes().
  client.ts    HttpClient + createHttpClient (build → interceptors → attempt loop).
  index.ts     Curated public API. Internals are not exported.
```

## Dependency graph (acyclic)

```
types    ← errors, url, retry, response, client
errors   ← client
url      ← client
retry    ← client
response ← client
client   ← index
index    → everything public
```

One direction only. `url`, `retry`, and `response` are pure and usable/testable on their
own, independent of the client.

## Request lifecycle

`request(method, path, options)`:

1. **Build** — resolve the URL (base + path + query), merge headers, and encode the body
   (`json` option or object → JSON with `content-type`; string/`Uint8Array` pass through).
   Run request interceptors (each may replace the request).
2. **Attempt loop** — for each attempt call `attempt()`, which:
   - creates an `AbortController`, arms an unref'd timeout timer, and links any caller
     `signal`;
   - calls the injected `fetch`;
   - buffers the WHATWG `Response` into an `HttpResponse`;
   - on throw, classifies the failure using `timedOut`/`userAborted` flags into
     `timeout` / `aborted` / `network`.
3. **Decide** —
   - a response runs response interceptors; a retriable status on an eligible method with
     attempts remaining sleeps (honoring `Retry-After`) and retries; otherwise a non-2xx
     throws `HttpError('status')` unless `throwOnError` is false;
   - a transport failure retries for eligible methods (never for a caller `abort`),
     otherwise throws `HttpError` with the classified kind.

## Retry & backoff

`computeBackoff` is `baseDelayMs * 2^attempt`, capped at `maxDelayMs`, with optional
jitter (`floor(delay * random())`, RNG injectable). `Retry-After` (delta-seconds or
HTTP-date) is honored on retriable responses when present and preferred over the computed
backoff (still capped). Only idempotent methods retry by default, so a `POST` is never
silently duplicated.

## Timeouts & abort

Every attempt is bounded by a per-request `AbortController`; the timer is unref'd so a
slow request cannot keep the process alive. A caller-supplied `signal` is combined with
the internal controller. The failure kind is disambiguated by flags set in the timeout
callback and the user-abort listener, so a timeout is retriable while a caller abort is
terminal.

## Testability

`fetch` and `sleep` are injected (defaults: global `fetch`, a real unref'd timer). Tests
supply a fake `fetch` that returns standard `Response` objects and a no-op `sleep`, so the
entire retry/timeout/interceptor surface is exercised deterministically with no network
and no real waits.

## Design boundaries (honest)

- Bodies are buffered fully into memory (`arrayBuffer`) for simple, repeatable reads;
  streaming very large responses is out of scope for this foundation client.
- No cookie jar, redirect policy customization, or multipart helpers — `fetch`'s defaults
  apply; richer needs can wrap the client or use interceptors.
- Header handling is a plain map (case preserved as given; `fetch` normalizes on the wire).

## Extension points

- **Interceptors** (`onRequest`/`onResponse`) for auth, tracing, metrics, logging.
- **Injected `fetch`** to route through a proxy, a mock, or an instrumented transport.
- **Custom retry policy** per client or per request.
- **DI**: consumers accept an `HttpClient` by type and receive one via the `HTTP_CLIENT`
  token; they depend on `@streetjs/http-client`, never the reverse.

## Testing

`node --test` with a fake `fetch` and no-op `sleep`: URL/query building, JSON and raw
bodies, explicit `json`, status errors and `throwOnError:false`, status retries (success
and give-up), non-idempotent no-retry, network-error retries, `Retry-After`, request and
response interceptors, caller-abort and already-aborted signals, timeout, all convenience
verbs, and the url/retry/response units. Coverage is enforced at ≥90% (`c8`); the
declaration-only `types.ts` is excluded.
