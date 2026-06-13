---
layout:    default
title:     "Consumer Platform Security"
parent:    "Security"
nav_order: 2
permalink: /security/consumer-platform/
description: "Consumer-platform security subsystems in StreetJS Framework — runtime validation, scoped rate limiting, security headers, upload guard, field encryption, abuse prevention, moderation, secret providers, and privacy controls."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Security</span>
<h1>Consumer Platform Security</h1>
<p>The hardened building blocks for high-risk consumer apps — dating, social, messaging, marketplaces. Runtime validation, scoped rate limiting, upload guards, field encryption, abuse prevention, moderation, pluggable secrets, and privacy controls. All in <code>@streetjs/core</code>, exported from <code>streetjs</code>.</p>
</div>

These subsystems extend StreetJS's existing security layer (`security/ratelimit.ts`, `security/headers.ts`, `multipart/parser.ts`, `security/vault.ts`) rather than replace it. Each one is built on `node:crypto` and the pluggable backing-store abstraction below, has no third-party runtime dependency beyond `zod` (used only by the Validator), and is re-exported from the package root.

```typescript
import {
  // Validation
  validate, validated, validateEnv, validateArgv, ValidationError,
  // Rate limiting
  rateLimit, parseWindow, InMemoryRateLimitStore, RedisRateLimitStore,
  // Headers
  computeSecurityHeaders, securityHeadersMiddleware,
  // Uploads
  UploadGuard, UploadRejected, stripJpegExif,
  // Field encryption
  Keyring, FieldCipher, isEncryptedField,
  // Abuse prevention
  AbuseEngine, InMemoryCounterStore,
  // Moderation
  ModerationToolkit, InMemoryModerationStore,
  // Secrets (aliased to avoid clashing with the cloud adapters)
  GitHubSecretsProvider, AwsSecretsProvider, requireSecrets,
  // Privacy
  PrivacyControls, InMemoryRetentionStore, ConsentRequiredError,
} from 'streetjs';
```

---

## Backing-store abstraction

Rate limiting, abuse counters, and similar subsystems need either in-process or shared cross-instance state. A small set of store interfaces makes an in-memory implementation (the default) and a shared external implementation interchangeable, so counts can be enforced consistently across many application instances.

| Interface | Purpose |
|-----------|---------|
| `KeyValueStore` | `get` / `set` (with optional TTL) / `delete` for small opaque values. |
| `CounterStore` | Sliding-window event counters — `increment`, `count`, `reset`. |
| `RateLimitStore` | Sliding-window request counts — `hit`, `count`. |

All time inputs are explicit milliseconds, and every in-memory store accepts an injected `Clock` (`() => number`) so window timing is deterministic in tests.

```typescript
import { InMemoryRateLimitStore, InMemoryCounterStore, systemClock } from 'streetjs';

// Deterministic clock for tests
let now = 0;
const store = new InMemoryRateLimitStore({ clock: () => now });

await store.hit('ip:1.2.3.4', now, 60_000);   // → 1 (hits in the window)
now += 30_000;
await store.count('ip:1.2.3.4', now, 60_000);  // → 1 (still inside the window)
now += 31_000;
await store.count('ip:1.2.3.4', now, 60_000);  // → 0 (rolled off)
```

The in-memory store is bounded: at most `maxKeys` (default 100K) distinct keys and `maxRequestsPerKey` (default 1K) timestamps per key, with oldest-key eviction at capacity. Provide `sweepIntervalMs` + `retentionMs` to enable a periodic memory sweep for idle keys.

---

## Runtime input validation

The Validator parses each declared input source against a [Zod](https://zod.dev) schema **before** the route handler runs. Malformed or malicious input is rejected with HTTP 400 and the handler never executes. Failure responses list only field paths and reasons — never stack traces or internal type information.

### Per-route validation

```typescript
import { z } from 'zod';
import { validate, validated } from 'streetjs';

const schemas = {
  body: z.object({ email: z.string().email(), age: z.number().int().min(18) }),
  query: z.object({ ref: z.string().optional() }),
  params: z.object({ id: z.string().uuid() }),
};

// validate() runs before the handler; on failure it throws ValidationError (400)
router.post('/users/:id', validate(schemas), async (ctx) => {
  // Inferred types: body.email is string, body.age is number, params.id is string
  const { body, params } = validated(ctx, schemas);
  await createUser(params.id, body.email, body.age);
});
```

Any subset of the five sources — `body`, `query`, `params`, `headers`, `cookies` — may be declared; only declared sources are validated. Parsed values are written to `ctx.state.valid.<source>`, and `validated(ctx, schemas)` returns them with each value's type inferred from its schema.

### Error shape

`ValidationError` extends StreetJS's `StreetException`, so the router error handler emits the 400 status and a safe body automatically:

```json
{
  "error": "ValidationError",
  "issues": [
    { "path": "body.email", "message": "Invalid email" },
    { "path": "body.age", "message": "Number must be greater than or equal to 18" }
  ]
}
```

Issues from every declared source are aggregated, so a single response lists all failing fields.

### Startup validation (env vars & CLI args)

Validate configuration at process startup. On failure, only the failing **names** are written to stderr — never their values — and the process exits non-zero (mirroring `vault.loadConfig`'s required-variable behavior).

```typescript
import { z } from 'zod';
import { validateEnv, validateArgv } from 'streetjs';

const env = validateEnv(z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
}));
// On failure: "Environment validation failed for: JWT_SECRET" → exit(1)

const args = validateArgv(z.object({
  port: z.coerce.number().int(),
  verbose: z.coerce.boolean().optional(),
}));
// Parses --port 3000 / --port=3000 / --verbose; repeated flags collect into arrays
```

---

## Scoped rate limiting

The original class-based `RateLimiter` remains for backward compatibility (see [JWT, Sessions, Vault, XSS & Rate Limiting]({{ '/security/jwt/' | relative_url }})). The `rateLimit()` factory adds three things: a human-readable window parser, explicit global / per-IP / per-user scopes, and a pluggable `RateLimitStore` for cross-instance enforcement. The sliding window, `Retry-After`, and `X-RateLimit-*` behavior is preserved.

```typescript
import { rateLimit } from 'streetjs';

// Per-IP: 100 requests per minute
router.use(rateLimit({ scope: 'ip', requests: 100, window: '1m' }));

// Per-user: 1000 requests per hour, keyed by the authenticated user id
router.use(rateLimit({ scope: 'user', requests: 1000, window: '1h' }));

// Global: a single shared bucket for an expensive endpoint
router.post('/reports/export', rateLimit({ scope: 'global', requests: 10, window: '1m' }));
```

| Scope | Key dimension |
|-------|---------------|
| `global` | One shared bucket for all traffic. |
| `ip` | Remote IP (direct socket address; set `trustProxy: true` only behind a trusted reverse proxy). |
| `user` | `ctx.user.id` by default, or a custom `userKeyFn`. Falls back to IP for unauthenticated traffic so the bucket is still bounded. |

When the limit is reached the request is rejected with HTTP 429, a `Retry-After` header (seconds to window roll-off), and `X-RateLimit-Remaining: 0`. Permitted responses carry `X-RateLimit-Remaining` with the leftover allowance.

### Window parsing

```typescript
import { parseWindow } from 'streetjs';

parseWindow('1m');    // 60_000
parseWindow('30s');   // 30_000
parseWindow('2h');    // 7_200_000
parseWindow('500ms'); // 500
parseWindow(5_000);   // 5_000  (numbers are already milliseconds)
// Non-positive or unparseable values throw.
```

### Cross-instance enforcement

By default each `rateLimit()` uses a fresh `InMemoryRateLimitStore`. To enforce limits consistently across multiple instances, supply a shared `RedisRateLimitStore`, which keeps a sorted set per key (trimmed with `ZREMRANGEBYSCORE`, counted with `ZCARD`, bounded with `PEXPIRE`):

```typescript
import { rateLimit, RedisRateLimitStore } from 'streetjs';

const store = new RedisRateLimitStore(redisClient, { keyPrefix: 'rl:' });
router.use(rateLimit({ scope: 'ip', requests: 100, window: '1m', store }));
```

`RedisRateLimitStore` accepts any client exposing `command(args)` — including the core `RedisClient`.

A reproducible benchmark harness lives at `packages/core/src/benchmarks/ratelimit.bench.ts`; it measures throughput (req/s) and per-request overhead and emits metrics JSON.

---

## Security headers

`computeSecurityHeaders()` produces hardened defaults — same-origin CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, a strict `Referrer-Policy`, and a locked-down `Permissions-Policy`. It is a pure function of its options, so the set of header names is identical across routes and bodies.

```typescript
import { securityHeadersMiddleware, computeSecurityHeaders } from 'streetjs';

// Defaults on every response
router.use(securityHeadersMiddleware());

// Inspect the computed map (useful for tests)
computeSecurityHeaders();
// {
//   'Content-Security-Policy': "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
//   'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
//   'X-Content-Type-Options': 'nosniff',
//   'X-Frame-Options': 'DENY',
//   'Cross-Origin-Opener-Policy': 'same-origin',
//   'Cross-Origin-Resource-Policy': 'same-origin',
//   'Referrer-Policy': 'strict-origin-when-cross-origin',
//   'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
// }
```

### Overriding and disabling

A supplied option value replaces the corresponding default. Headers named in `disable` (or zeroed with the `csp: false` / `hstsMaxAge: 0` sentinels) are omitted entirely:

```typescript
securityHeadersMiddleware({
  csp: { 'default-src': ['self'], 'img-src': ['self', 'https://cdn.example.com'] },
  frameOptions: 'SAMEORIGIN',
  hstsMaxAge: 86_400,
  disable: ['Permissions-Policy'], // omit this header from the response
});
```

The `buildCsp()` helper quotes CSP keywords (`self`, `none`, `unsafe-inline`, nonces/hashes) automatically and emits hosts/schemes verbatim. A `true` directive value produces a valueless directive (e.g. `upgrade-insecure-requests`).

---

## Upload guard

`UploadGuard` is a post-parse validation layer over `MultipartParser`. It consumes the `ParsedFile[]` the parser already streamed to disk and enforces upload policy, unlinking the temp file on any rejection so a rejected upload is never persisted.

```typescript
import { UploadGuard, UploadRejected } from 'streetjs';

const guard = new UploadGuard({
  maxBytes: 5 * 1024 * 1024,         // 5 MB
  imageOnly: true,                    // only JPEG/PNG/GIF accepted
  allowedMimeTypes: ['image/jpeg', 'image/png'],
  stripExif: true,                    // remove EXIF from accepted JPEGs
  malwareScan: async (file) => ({ malicious: await scan(file.path) }),
});

try {
  const { accepted } = await guard.guard(parsedFile);
  // accepted.detectedMime — true format from magic bytes
  // accepted.storedName  — random hex name + extension, no path separators
  await persist(accepted);
} catch (err) {
  if (err instanceof UploadRejected) {
    ctx.status(err.status); // 413 or 415
    ctx.json({ error: err.code, message: err.message });
  }
}
```

The guard enforces, in order:

| Check | Rejection |
|-------|-----------|
| Size cap (`maxBytes`) | `413 TOO_LARGE` |
| Image-only mode (non-image signature) | `415 DISALLOWED_TYPE` |
| Declared MIME ≠ true format from magic bytes | `415 MIME_MISMATCH` |
| True format not in `allowedMimeTypes` | `415 DISALLOWED_TYPE` |
| Malware-scan hook reports malicious (or throws) | `415 MALWARE` |

True format is detected from the leading bytes (`detectFormat`): JPEG (`FF D8 FF`), PNG (`89 50 4E 47 0D 0A 1A 0A`), GIF (`47 49 46 38`), PDF (`25 50 44 46`). The malware hook runs **before** persistence and is fail-closed. The stored filename is derived from `randomBytes(16)` plus a format extension — it never contains path separators or the client-supplied name.

`stripJpegExif(buffer)` is also exported standalone: it removes APP1/EXIF segments from a JPEG byte stream, returning a valid JPEG with no EXIF metadata (non-JPEG input is returned unchanged).

---

## Field-level encryption

`EncryptedField<T>` and `FieldCipher` encrypt selected sensitive fields — message content, phone numbers, addresses, private notes, profile metadata — at rest using AES-256-GCM, reusing the GCM layout proven in `vault.ts`/`session.ts`. Envelope encryption is layered on top so KEK rotation never requires re-encrypting historical data.

```typescript
import { Keyring, FieldCipher } from 'streetjs';
import { randomBytes } from 'node:crypto';

// One or more versioned 32-byte Key Encryption Keys; highest version is "current"
const keyring = new Keyring([{ version: 1, kek: randomBytes(32) }]);
const cipher = new FieldCipher(keyring);

const enc = cipher.encrypt('+1-555-0100');   // EncryptedField<string>
const plain = cipher.decrypt(enc);            // '+1-555-0100'  (round-trips)
```

How it works:

1. A fresh per-value **Data Encryption Key (DEK)** AES-256-GCMs the JSON-serialized plaintext.
2. The DEK is itself wrapped (encrypted) under the keyring's **current Key Encryption Key (KEK)**.
3. The stored `EncryptedEnvelope` records the KEK `version`, the `wrappedDek`, the data `iv`, the auth `tag`, and the `ct` — all base64, so the envelope is JSON-safe.

### Key rotation

Add a higher KEK version; it becomes current for new writes. Older envelopes still carry the version whose KEK can unwrap their DEK, so they remain decryptable without re-encryption:

```typescript
const rotated = new Keyring([
  { version: 1, kek: oldKek }, // retained so old data still decrypts
  { version: 2, kek: newKek }, // current — used for new writes
]);
new FieldCipher(rotated).decrypt(envelopeEncryptedUnderV1); // still works
```

### Tamper detection

Any alteration of the ciphertext, auth tag, or wrapped DEK causes GCM authentication to fail. `decrypt` throws and never returns plaintext. Use `isEncryptedField(value)` to test whether an arbitrary value is a serialized envelope.

---

## Abuse prevention

`AbuseEngine` is a counter-backed engine consulted by the authentication path. It derives every stateful decision from sliding-window counters in an injected `CounterStore`, so it holds no per-account state on the instance and the same store can be shared across instances.

```typescript
import { AbuseEngine, InMemoryCounterStore } from 'streetjs';

const engine = new AbuseEngine(
  {
    loginFailureThreshold: 5, loginWindowMs: 15 * 60_000, lockoutMs: 30 * 60_000,
    signupThreshold: 3, signupWindowMs: 60 * 60_000,
    sprayDistinctAccounts: 10, sprayWindowMs: 10 * 60_000,
    scoreThreshold: 8,
    responseAction: (decision) => alertSecurityTeam(decision),
  },
  new InMemoryCounterStore(),
  async (ip) => reputationService.risk(ip), // optional IP-reputation hook
);

// On each login attempt
const decision = await engine.recordLoginAttempt({
  ip: ctx.ip, accountId: user.id, failed: !passwordOk, ts: Date.now(),
});
if (!decision.allowed) {
  // decision.reason: 'LOCKED_OUT' | 'SCORE_EXCEEDED'
  // decision.retryAfterMs, decision.score
  throw new TooManyRequestsException();
}
```

Capabilities:

- **Account lockout** — once failed logins for an account reach `loginFailureThreshold` within `loginWindowMs`, the account is locked for `lockoutMs`; attempts during lockout are refused. Check directly with `isLockedOut(accountId, now)`.
- **Signup throttling** — `recordSignupAttempt(ip, ts)` throttles a source once its attempts reach `signupThreshold` within `signupWindowMs`.
- **Password-spray classification** — `detectPasswordSpray(ip, now)` is true when failed logins from one source span at least `sprayDistinctAccounts` distinct accounts within `sprayWindowMs`.
- **Suspicious-activity score** — `score(signal)` sums recent failed-login count, distinct-account spray pressure, and the IP-reputation hook's contribution; reaching `scoreThreshold` triggers the configured `responseAction` and refuses the attempt.

All time inputs are explicit milliseconds with an injected clock, so behavior is deterministic under test.

---

## Moderation toolkit

`ModerationToolkit` provides report / block / mute APIs over a pluggable `ModerationStore`, an exposed moderation queue, and an append-only audit log. Every state-changing operation appends an immutable `AuditEvent`; the public API exposes only append + list, so recorded events cannot be modified through it.

```typescript
import { ModerationToolkit, InMemoryModerationStore } from 'streetjs';

const mod = new ModerationToolkit(new InMemoryModerationStore());

// Reporting — stored and placed in the queue
const report = await mod.report('alice', 'mallory', 'harassment');

// Blocking — A blocks B; B can no longer message A
await mod.block('alice', 'mallory');
await mod.canMessage('mallory', 'alice'); // false
await mod.canMessage('alice', 'mallory'); // true

// Muting — scoped to the muting user only
await mod.mute('alice', 'bob');
await mod.deliverable('alice', [{ sender: 'bob' }, { sender: 'carol' }]);
// → [{ sender: 'carol' }]   (bob suppressed for alice only; others unaffected)

// Moderation queue
const pending = await mod.queue();
await mod.resolve('moderator-1', report.id, 'banned');

// Append-only audit log: actor, target, action, timestamp
const events = await mod.audit();
```

`canMessage(from, to)` returns `true` if and only if `to` has not blocked `from`. `deliverable(recipient, items)` suppresses items whose sender the recipient has muted, leaving the same items intact for other recipients. `resolve` throws `UnknownReportError` for an unknown report id. Audit events are deep-frozen and the store exposes no update/delete path.

---

## Secret providers

A single `SecretProvider` interface (`get(name)`) is implemented by first-class adapters for GitHub Secrets, AWS Secrets Manager, Azure Key Vault, and GCP Secret Manager. The cloud adapters delegate retrieval to StreetJS's existing SDK-free providers and add refresh-on-read plus automatic log redaction.

> The provider interface and three cloud adapter classes share names with the existing `cloud/secret-providers.ts` exports, so the consumer-platform variants are re-exported under aliased names: `SecretsProvider`, `AwsSecretsProvider`, `AzureSecretsProvider`, `GcpSecretsProvider` (and `GitHubSecretsProvider`, which is unique).

```typescript
import { AwsSecretsProvider, requireSecrets, redact } from 'streetjs';

const secrets = new AwsSecretsProvider({
  region: 'us-east-1',
  accessKeyId: process.env['AWS_ACCESS_KEY_ID']!,
  secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY']!,
});

const dbPassword = await secrets.get('prod/db/password');
```

- **Refresh-on-read (no restart for rotation)** — every adapter re-reads its upstream on each `get()` by default (`ttlMs: 0`), so a value rotated in the external store is observed on the next request. A positive `ttlMs` trades a short staleness window for fewer upstream calls; even then a rotated value appears once the TTL elapses.
- **Log redaction** — every retrieved value is registered with the redaction registry. `redact(line)` masks any registered value with `[REDACTED]` before a line reaches a log sink, including startup error handlers. `registerSecretForRedaction(value)` registers a value manually.
- **Required-secret startup gate** — `requireSecrets(provider, names)` fetches each required secret and returns a `name → value` map. If any cannot be retrieved it emits **only the missing names** (never values or upstream error detail) and exits non-zero, mirroring `vault.loadConfig`:

```typescript
const required = await requireSecrets(secrets, ['JWT_SECRET', 'DB_PASSWORD']);
// Missing → stderr: "Missing required secret(s): DB_PASSWORD" → process.exit(1)
```

The GitHub adapter resolves secrets from the process environment (the GitHub Actions runner injects them), which is inherently refresh-on-read. Each cloud adapter also accepts a `fetcher` seam for testing against a mocked SDK without real network calls.

---

## Privacy controls

`PrivacyControls` provides account deletion, data export, retention enforcement, and consent tracking. It is storage-agnostic: applications register a `PersonalDataSource` per data domain, and export/deletion fan out across every registered source.

```typescript
import { PrivacyControls, InMemoryRetentionStore } from 'streetjs';

const privacy = new PrivacyControls({
  policies: [{ recordType: 'message', maxAgeMs: 90 * 86_400_000 }], // 90 days
  retentionStore: new InMemoryRetentionStore(),
});

privacy.registerSource({
  name: 'profiles',
  collect: (userId) => profileRepo.exportFor(userId),
  erase: (userId) => profileRepo.deleteFor(userId),
});
```

### Export and deletion

```typescript
// Export: namespaced by each source's name so domains don't collide
const pkg = await privacy.exportData('user-123');
// { profiles: {...}, messages: {...}, ... }

// Deletion: erase across every registered source so subsequent reads return nothing
await privacy.deleteAccount('user-123');
```

### Retention

`enforceRetention(now)` runs a single cycle: a record is removed when a policy exists for its type and its age (`now - createdAt`) exceeds the policy's `maxAgeMs`. Records without a policy, or not yet expired, are retained. Add or replace a policy at runtime with `addRetentionPolicy(policy)`.

```typescript
const { removed } = await privacy.enforceRetention(Date.now());
```

### Consent

Decisions are recorded per `(user, purpose)` with the latest decision winning (by timestamp). Withdrawn consent makes `requireConsent` refuse purpose-dependent processing:

```typescript
privacy.setConsent({ userId: 'user-123', purpose: 'marketing', granted: true, ts: Date.now() });
privacy.hasConsent('user-123', 'marketing'); // true

privacy.setConsent({ userId: 'user-123', purpose: 'marketing', granted: false, ts: Date.now() });
privacy.requireConsent('user-123', 'marketing'); // throws ConsentRequiredError
```

When no decision has been recorded, `hasConsent` returns `false` and `requireConsent` passes (there is nothing to refuse).

---

## Production checklist

- [ ] `validate()` guards every route that accepts external input; `validateEnv`/`validateArgv` gate startup configuration
- [ ] `rateLimit()` is applied with appropriate scopes; a shared `RedisRateLimitStore` is configured when running multiple instances
- [ ] `securityHeadersMiddleware()` is applied globally
- [ ] `UploadGuard` wraps every upload path with a size cap, magic-byte checks, and a malware-scan hook
- [ ] Sensitive fields use `EncryptedField` with a versioned `Keyring`; KEKs are sourced from a `SecretProvider`, never hard-coded
- [ ] `AbuseEngine` is consulted on every login and signup attempt
- [ ] `ModerationToolkit` backs report/block/mute flows; the audit log is reviewed regularly
- [ ] Required secrets pass through `requireSecrets` at startup; the logger applies `redact()`
- [ ] `PrivacyControls` sources are registered for every personal-data domain; a retention cycle is scheduled and consent is checked before purpose-bound processing
