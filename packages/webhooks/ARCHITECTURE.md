# @streetjs/webhooks — Architecture

## Goals

- A single, generic webhooks foundation (both sender and receiver) for StreetJS.
- Zero runtime dependencies (Node core `crypto` + an injectable transport).
- Vendor-neutral, secure-by-default: HMAC-SHA256, constant-time verify, replay window.
- Strongly typed, interface-first; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  types.ts       Public interfaces: sign/verify options, endpoint, event, transport.
  signature.ts   HMAC signing, header parsing, constant-time verification.
  transport.ts   FetchWebhookTransport (default, bounded timeout).
  dispatcher.ts  WebhookDispatcher: envelope + sign + deliver with retries.
  index.ts       Curated public API. Internals are not exported.
```

## Dependency graph (acyclic)

```
types      ← signature, transport, dispatcher
signature  ← dispatcher
transport  ← dispatcher
dispatcher ← index
index      → everything public
```

One direction only. `signature.ts` is fully independent of delivery, so receivers can
import just the verification path without pulling in the transport.

## Signature scheme

`signed content = ${timestamp}.${payload}`; the header is `t=<ts>,v1=<hex HMAC-SHA256>`.
Binding the timestamp into the signed content means a captured request cannot be replayed
outside the tolerance window without invalidating the signature. `v1` is a versioned
scheme identifier, leaving room for future algorithms.

## Verification

`verifySignature` parses the header, recomputes the HMAC over `${t}.${payload}`, and
compares in constant time via `crypto.timingSafeEqual` on decoded byte buffers. A length
or decode mismatch fails closed. It then checks `|now - t| <= toleranceSec` (default
300s). It never throws on malformed input — every failure is a `{ valid: false, reason }`.
Receivers must verify against the **raw** request body: re-serializing a parsed object can
change bytes (key order, spacing) and break the signature.

## Delivery

`dispatch` builds a canonical JSON envelope `{ id, type, created, data }` (id generated
via `crypto.randomUUID` when absent), signs it with the endpoint secret and the `created`
timestamp, sets the `webhook-*` headers, and delivers via the transport. Any 2xx is
success; non-2xx responses and transport errors are retried with exponential backoff
(`baseDelayMs * 2^attempt`, capped at `maxDelayMs`) up to `retries` additional attempts.
The result reports `delivered`, the `id`, the attempt count, and the final status or
error.

## Injection & testing

The transport, `sleep`, and `clock` are all injectable. Tests supply a fake transport
that records requests and returns scripted statuses, plus a no-op `sleep`, exercising the
full sign → deliver → retry → verify flow deterministically with no network and no real
waits. The default `FetchWebhookTransport` uses global `fetch` with an unref'd timeout.

## Design boundaries (honest)

- One active signature scheme (`v1` = HMAC-SHA256). Verifying multiple candidate
  signatures or rotating secrets is left to the caller (verify against each secret).
- No persistent delivery queue or dead-letter store — `dispatch` is a single
  (retrying) delivery. Durable queueing belongs in `@streetjs/queue`/`@streetjs/jobs`,
  which can call this package to sign and send.
- The default transport reports only the status code; richer response handling can use a
  custom `WebhookTransport`.

## Extension points

- **Custom transports** implement `WebhookTransport` (route through a proxy, add auth,
  integrate `@streetjs/http-client`, or capture for tests).
- **Injected `clock`/`sleep`** for determinism.
- **DI** via the `WEBHOOK_DISPATCHER` token; consumers depend on `@streetjs/webhooks`,
  never the reverse.

## Testing

`node --test`: signing/header format, valid verification, tamper/wrong-secret/expired/
future-timestamp/malformed/empty/odd/non-hex signature failures, header parsing (extras,
bare parts, non-string), dispatch success/headers/merge/generated-id, status and
transport-error retries with give-up, the default real timer, envelope stability, and the
fetch transport (POST, timeout abort, missing fetch). Coverage is enforced at ≥90%
(`c8`); the declaration-only `types.ts` is excluded.
