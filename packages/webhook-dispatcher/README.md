# @streetjs/webhook-dispatcher

The outbound webhook dispatcher for StreetJS: an **SSRF-hardened, HTTPS-only delivery
queue** with HMAC-SHA256 signatures, bounded queue + concurrency, exponential-backoff
retries, DNS-rebinding protection, and private-CA TLS.

**Zero runtime dependencies.** Built on Node.js core only, matching the StreetJS minimal,
carefully curated dependency footprint.

```bash
npm install @streetjs/webhook-dispatcher
```

> **Not** the same as [`@streetjs/webhooks`](https://www.npmjs.com/package/@streetjs/webhooks).
> `@streetjs/webhooks` is a generic **sign/verify/deliver library** (both sides, injectable
> transport, `t=,v1=` scheme). **This** package is the framework's hardened **sender**: a
> queue with SSRF protection and the `X-Street-Signature: sha256=…` scheme. It backs the
> `streetjs/webhook` subpath, so `streetjs` re-exports it (single implementation).

## Usage

```ts
import { WebhookDispatcher } from '@streetjs/webhook-dispatcher';

const dispatcher = new WebhookDispatcher();

dispatcher.enqueue(
  { url: 'https://consumer.example/hooks', secret: 'shared-secret', maxRetries: 3, timeoutMs: 10_000 },
  'user.created',
  { id: 7 },
);

// On shutdown:
dispatcher.stop();
```

`enqueue` returns synchronously (`true` unless the dispatcher is stopped or the queue is
full). URL validation and delivery happen asynchronously; an invalid/unsafe target is
dropped with a one-per-URL error log.

## Security

- **HTTPS only** — non-`https:` targets are rejected (payload confidentiality).
- **SSRF blocklist** — private, loopback, link-local (incl. AWS IMDS `169.254.169.254`),
  ULA, and reserved ranges are blocked, both as URL host literals and as **resolved** IPs
  (DNS-rebinding protection).
- **TLS validation is always on** — `rejectUnauthorized: false` is never forwarded to the
  HTTPS layer. Trust a private/corporate CA by supplying `tls.ca` on the target.
- **HMAC-SHA256 signature** — each request carries `X-Street-Signature: sha256=<hex>` over
  the exact JSON body; receivers verify against the shared secret.
- **`allowedHosts`** — a constructor allowlist that bypasses the SSRF blocklist **for test
  environments only** (e.g. a localhost HTTPS server). Never pass user-controlled values.

## Delivery semantics

- **Bounded queue** (10 000) and **bounded concurrency** (32); a full queue drops events.
- **Retries** with exponential backoff (`2^attempt` seconds, capped at 30 s) up to
  `maxRetries` (default 3); a 2xx is success, anything else retries.
- `buildRequestOptions(...)` is exported so the produced HTTPS options are unit-testable
  (e.g. asserting TLS validation is never disabled).

## Public API

`WebhookDispatcher` · `buildRequestOptions` · `WebhookPayload` · `WebhookTarget` ·
`WebhookJob` · `WEBHOOK_DISPATCHER` token.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design notes, and
`src/examples/integration.ts` for a runnable example.

## License

MIT © street contributors
