# @streetjs/webhooks

The webhooks foundation for StreetJS: **generic outbound webhook signing and delivery**
(HMAC-SHA256, timestamped signatures, retries) plus **constant-time incoming signature
verification** with replay protection.

**Zero runtime dependencies.** Built on Node.js core (`crypto`) only, with an injectable
transport, matching the StreetJS minimal, carefully curated dependency footprint. Generic
and reusable by any application — not tied to any vendor.

```bash
npm install @streetjs/webhooks
```

## Why

Both sides of a webhook need the same guarantees: the sender signs each payload and
retries transient failures; the receiver verifies the signature in constant time and
rejects replays. `@streetjs/webhooks` provides both, with a vendor-neutral signature
scheme and an injectable transport so delivery is fully testable without network access.

## Signature scheme

```
signed content = `${timestamp}.${payload}`
header value    = `t=${timestamp},v1=${hex(HMAC-SHA256(secret, signedContent))}`
```

The timestamp is bound into the signature, so verification also enforces a freshness
window (replay protection).

## Sending

```ts
import { WebhookDispatcher } from '@streetjs/webhooks';

const dispatcher = new WebhookDispatcher({ retries: 3 }); // default fetch transport

const result = await dispatcher.dispatch(
  { url: 'https://consumer.example/hooks', secret: process.env.WHSEC!, headers: { 'x-tenant': 'acme' } },
  { type: 'user.created', data: { id: 7 } },
);
// result: { delivered, id, attempts, status?, error? }
```

The delivered POST carries a JSON envelope `{ id, type, created, data }` and headers:

| Header | Meaning |
|---|---|
| `webhook-signature` | `t=…,v1=…` signature over the raw body |
| `webhook-id` | unique event id (generated if omitted) |
| `webhook-event` | event type |
| `webhook-timestamp` | creation time (seconds) |

Delivery retries transient failures (non-2xx or transport errors) with exponential
backoff (`retries`, `baseDelayMs`, `maxDelayMs`). Success is any 2xx.

## Receiving / verifying

```ts
import { verifySignature } from '@streetjs/webhooks';

// Verify against the *raw* request body (not a re-serialized object).
const result = verifySignature(rawBody, req.headers['webhook-signature'], secret, {
  toleranceSec: 300, // replay window; default 300s
});
if (!result.valid) {
  return res.writeHead(400).end(result.reason); // "malformed signature header" | "signature mismatch" | "timestamp outside tolerance"
}
```

Verification uses `crypto.timingSafeEqual` and never throws on malformed input.

## Transports

The default transport uses global `fetch` with a bounded timeout. Inject your own (or a
fake for tests) by implementing `WebhookTransport`:

```ts
import { WebhookDispatcher, FetchWebhookTransport } from '@streetjs/webhooks';

new WebhookDispatcher({ transport: new FetchWebhookTransport({ timeoutMs: 5000 }) });

// Tests: capture requests, no network.
new WebhookDispatcher({
  transport: { async send(req) { captured.push(req); return { status: 200 }; } },
  sleep: async () => {},
});
```

## Dependency injection

Depends on no container. Exports a `WEBHOOK_DISPATCHER` token (a global `Symbol`):

```ts
import { WEBHOOK_DISPATCHER, WebhookDispatcher } from '@streetjs/webhooks';
container.register(WEBHOOK_DISPATCHER, new WebhookDispatcher());
```

## Public API

`signPayload` · `verifySignature` · `parseSignatureHeader` · `WebhookDispatcher` /
`buildEnvelope` / header-name constants · `FetchWebhookTransport` · `WEBHOOK_DISPATCHER`
token · types (`WebhookEndpoint`, `WebhookEvent`, `DispatchResult`, `WebhookTransport`,
`SignatureResult`, `VerifyResult`, …).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module layout and design notes, and
`src/examples/integration.ts` for a runnable end-to-end example (network-free).

## License

MIT © street contributors
