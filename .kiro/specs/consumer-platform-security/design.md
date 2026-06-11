# Design Document

## Overview

This design turns the ten-phase consumer-platform-security roadmap (Requirements 1–12) into a concrete plan that **extends the existing `@streetjs/core` package and monorepo rather than rebuilding it**. Every phase maps onto either an existing module in `packages/core/src/security/` (or `multipart/`, `verification/`) that is extended in place, or a new module added beside the existing ones and re-exported from `packages/core/src/index.ts`. Phase 10 adds four new packages under `packages/`.

The work is delivered under the **Zero-Trust Certification Standard** (Requirement 1). Crucially, the framework already contains the evidence-capturing machinery this standard needs: `packages/core/src/verification/` provides a `CommandRunner` that executes a real command, derives evidence components, classifies a status with a pure `classify()` engine, and writes an atomic JSON artifact (`runner.ts`, `artifact.ts`, `status.ts`), plus an `aggregator.ts` that computes a roll-up decision *solely* from recorded artifacts. This design **reuses that subsystem** as the substrate for the Certification Report (Requirement 12), adding a consumer-platform capability set and a category scorecard aggregator. No `VERIFIED` status is asserted in any document; statuses are produced from executed-command output during task execution.

Key existing assets this design builds on (verified by inspection):

| Phase | Requirement | Existing asset | Strategy |
|-------|-------------|----------------|----------|
| 1 Validation | R2 | `core/types.ts` `ValidationSchema`/`FieldRule`; `core/context.ts` | Add Zod-based `Validator` (new dependency), keep typed inference. New module `security/validation.ts`. |
| 2 Rate limiting | R3 | `security/ratelimit.ts` (`RateLimiter`, sliding window, `Retry-After`, `X-RateLimit-*`) | Extend: add backing-store abstraction, per-scope limiters, benchmark harness. |
| 3 Security headers | R4 | `security/headers.ts` (`computeSecurityHeaders`, `DEFAULT_CSP`, per-header opts) | Extend: add `Permissions-Policy` default already present; add explicit per-header disable. |
| 4 Upload security | R5 | `multipart/parser.ts` (`MultipartParser`, `sanitizeFileName`, random stored name) | Extend: add `Upload_Guard` wrapper for magic-byte, MIME match, EXIF strip, malware hook. |
| 5 Field encryption | R6 | `security/vault.ts` (AES-256-GCM helpers, scrypt KEK), `security/session.ts` (GCM patterns) | New `security/encrypted-field.ts` reusing GCM patterns + envelope encryption + keyring. |
| 6 Abuse prevention | R7 | `security/jwt.ts`, `security/session.ts`, `auth/*` | New `security/abuse.ts` consulted by auth middleware. |
| 7 Moderation | R8 | `auth/audit-writer.ts` (audit patterns) | New `security/moderation.ts` (report/block/mute/queue/audit). |
| 8 Secrets | R9 | `security/vault.ts` (`loadConfig`, required-var failure, decrypt) | New `security/secret-provider.ts` interface + adapters, building on vault. |
| 9 Privacy | R10 | — | New `security/privacy.ts` (export/delete/retention/consent). |
| 10 Dating reference | R11 | plugins layout; `auth/*`; phases 5/7 | Four new packages composing core primitives. |
| 1/12 Certification | R1, R12 | `verification/{runner,artifact,status,aggregator}.ts` | Reuse runner/artifact; add consumer-platform capability set + category scorecard aggregator. |

### PBT applicability assessment

Most subsystems here expose **pure, input-varying logic** that is ideal for property-based testing: encryption round-trips, validation determinism, sliding-window threshold behavior, header-set invariance, the block-prevents-messaging invariant, audit immutability, and the deletion invariant. The repo already standardizes on `fast-check` with `node --test` (e.g. `packages/core/src/tests/dast-coverage-pbt.test.ts`, `NUM_RUNS = 100`). Therefore this design **includes a Correctness Properties section**. Genuinely non-PBT concerns (secret-store adapter wiring, package publication, scorecard infrastructure) are covered by integration/smoke tests in the Testing Strategy instead.

## Architecture

### System context

```mermaid
graph TD
  subgraph core["@streetjs/core (packages/core/src)"]
    CTX[core/context.ts<br/>StreetContext]
    subgraph sec["security/"]
      VAL[validation.ts<br/>Validator R2]
      RL[ratelimit.ts<br/>Rate_Limiter R3 extend]
      HDR[headers.ts<br/>Security_Headers R4 extend]
      ENC[encrypted-field.ts<br/>EncryptedField R6]
      ABU[abuse.ts<br/>Abuse_Engine R7]
      MOD[moderation.ts<br/>Moderation_Toolkit R8]
      SEC[secret-provider.ts<br/>SecretProvider R8/R9]
      PRIV[privacy.ts<br/>Privacy_Controls R10]
      VLT[vault.ts<br/>existing]
      JWT[jwt.ts / session.ts<br/>existing]
    end
    MP[multipart/parser.ts<br/>+ upload-guard.ts R5]
    subgraph ver["verification/"]
      RUN[runner.ts CommandRunner]
      ART[artifact.ts]
      STS[status.ts classify]
      AGG[aggregator.ts<br/>+ certification.ts R12]
    end
    IDX[index.ts<br/>public exports]
  end

  subgraph stores["Backing stores (pluggable)"]
    MEM[InMemoryStore]
    REDIS[RedisStore<br/>@streetjs/plugin-redis]
    S3[S3/R2 storage<br/>plugin-s3 / plugin-r2]
  end

  subgraph dating["packages/ (Phase 10, new)"]
    DA[@streetjs/dating-auth]
    DP[@streetjs/dating-profiles]
    DM[@streetjs/dating-messaging]
    DMOD[@streetjs/dating-moderation]
  end

  RL --> MEM & REDIS
  ABU --> MEM & REDIS
  MOD --> MEM & REDIS
  ENC --> SEC
  MP --> S3
  DA --> JWT & ABU
  DP --> ENC
  DM --> ENC & MOD
  DMOD --> MOD
  RUN --> ART --> STS
  AGG --> ART
  IDX --> sec & ver & MP
```

### Cross-cutting design decisions

1. **Extend, don't replace.** R3.1, R4.1, R5.1, R8.1(secrets) and R9.1 explicitly require extension. New capabilities are added as new exported functions/classes in the existing files (rate limiter scopes, header disable) or as sibling modules that *compose* the existing primitives (Upload_Guard wraps `MultipartParser`; `EncryptedField` reuses the GCM layout from `vault.ts`/`session.ts`).

2. **Pluggable backing-store abstraction (R3.8).** Rate limiting, abuse counters, and moderation/privacy persistence all need either in-process or shared cross-instance state. A single small `KeyValueStore` / `CounterStore` abstraction is introduced so an `InMemoryStore` (default) and a `RedisStore` (via the existing `@streetjs/plugin-redis`) are interchangeable. This keeps the core dependency-free while enabling multi-instance enforcement.

3. **Middleware-first integration.** New subsystems expose `MiddlewareFn` factories (matching the existing `RateLimiter.middleware()` / `securityHeadersMiddleware()` shape) so they slot into the router pipeline and `StreetContext` without new plumbing.

4. **Evidence is produced, never asserted (R1.3, R12.5).** The certification layer is a thin extension of the existing `verification/` subsystem: task execution runs real commands through `CommandRunner`, artifacts land on disk, and a new `certification.ts` aggregator rolls artifacts up into per-category statuses. Documents (this one included) record *how* evidence is captured, never a `VERIFIED` verdict.

### Export strategy

Every new module is re-exported from `packages/core/src/index.ts` next to the existing security/verification exports (R1.1 "public package exports"). Phase 10 packages each ship their own `package.json` with `main`/`types`/`exports` mirroring the existing `@streetjs/plugin-*` packages and depend on `@streetjs/core`.

## Components and Interfaces

### Phase 1 — Validator (`security/validation.ts`, R2)

Introduces a **Zod** dependency (new to the repo) for runtime schemas with static type inference. The existing hand-rolled `ValidationSchema`/`FieldRule` in `core/types.ts` is retained for backward compatibility; the Zod path is the new recommended API.

```ts
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import type { MiddlewareFn, StreetContext } from '../core/index.js';

export type InputSource = 'body' | 'query' | 'params' | 'headers' | 'cookies';

/** A per-source schema set; any subset of sources may be declared (R2.1). */
export interface RouteSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
  headers?: ZodTypeAny;
  cookies?: ZodTypeAny;
}

/** A single field failure in serialized form (R2.4). */
export interface FieldIssue { path: string; message: string }

export class ValidationError extends Error {
  readonly status = 400;
  readonly issues: FieldIssue[];
  constructor(issues: FieldIssue[]);
  /** Safe body: field paths + reasons only; no stack/internal types (R2.5). */
  toResponse(): { error: 'ValidationError'; issues: FieldIssue[] };
}

/**
 * Validate each declared source against its schema. On success, parsed/typed
 * values are written to ctx.state.valid.<source> and the handler runs (R2.2/2.6).
 * On any failure, throws ValidationError (HTTP 400) BEFORE next() so the
 * handler never executes (R2.3).
 */
export function validate(schemas: RouteSchemas): MiddlewareFn;

/** Typed accessor giving handlers inferred types (R2.6). */
export function validated<S extends RouteSchemas>(
  ctx: StreetContext, schemas: S,
): { [K in keyof S]: S[K] extends ZodTypeAny ? ZodInfer<S[K]> : never };

/** Startup validation of env vars / CLI args (R2.7, R2.8). */
export function validateEnv<S extends ZodTypeAny>(schema: S, env?: NodeJS.ProcessEnv): ZodInfer<S>;
export function validateArgv<S extends ZodTypeAny>(schema: S, argv?: string[]): ZodInfer<S>;
```

- **Handler-skip guarantee (R2.3):** `validate()` parses *before* calling `next()`; a thrown `ValidationError` short-circuits the pipeline so the handler body never runs.
- **Safe formatting (R2.5):** `ValidationError.toResponse()` maps Zod issues to `{path, message}` only. The router's error handler serializes that, never `error.stack`.
- **Startup failure (R2.8):** `validateEnv`/`validateArgv` collect failing **names**, print them to stderr, and call `process.exit(1)` — values are never logged (mirrors `vault.loadConfig`'s required-var behavior).
- **Determinism (R2.9):** validation is a pure parse; repeated validation of the same conforming input yields a structurally equal value (property below).

### Phase 2 — Rate_Limiter (extends `security/ratelimit.ts`, R3)

The existing `RateLimiter` already implements a bounded sliding window with `Retry-After` and `X-RateLimit-*` headers. This phase **adds** (a) a backing-store abstraction so counts can be shared across instances (R3.8), (b) explicit global / per-IP / per-user scopes (R3.2), and (c) a benchmark harness (R3.9).

```ts
/** Backing-store abstraction for sliding-window counts (R3.8). */
export interface RateLimitStore {
  /**
   * Record a hit at nowMs for key and return the count of hits within
   * [nowMs - windowMs, nowMs]. Implementations MUST evaluate the window
   * atomically so concurrent instances agree.
   */
  hit(key: string, nowMs: number, windowMs: number): Promise<number>;
  /** Hits currently counted in the window (for remaining-allowance headers). */
  count(key: string, nowMs: number, windowMs: number): Promise<number>;
}

export class InMemoryRateLimitStore implements RateLimitStore { /* current Map-based logic */ }

/** Redis-backed store (sorted-set per key) for cross-instance enforcement. */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(redis: RedisLike, opts?: { keyPrefix?: string });
}

export type RateScope = 'global' | 'ip' | 'user';

export interface ScopedRateLimitOptions {
  scope: RateScope;
  requests: number;        // maxRequests
  window: string | number; // "1m" | ms  (R3.7 human-readable window)
  store?: RateLimitStore;  // defaults to InMemoryRateLimitStore
  userKeyFn?: (ctx: StreetContext) => string | undefined; // for scope:'user'
}

/** Factory equivalent to rateLimit({ requests: 100, window: "1m" }) (R3.7). */
export function rateLimit(opts: ScopedRateLimitOptions): MiddlewareFn;

/** Parse "1m"/"30s"/"2h" → ms. */
export function parseWindow(window: string | number): number;
```

- **Sliding window (R3.6):** preserved from the existing BigInt-timestamp algorithm; the store interface exposes the same semantics so `RedisRateLimitStore` uses a sorted set keyed by timestamp with `ZREMRANGEBYSCORE` trimming.
- **Threshold + 429 (R3.3/3.4/3.5):** when `hit()` count reaches `requests`, respond `429` with `Retry-After` (seconds to window roll-off) and `X-RateLimit-Remaining: 0`; otherwise set `X-RateLimit-Remaining` to the leftover allowance.
- **Benchmark (R3.9):** a reproducible harness under `packages/core/src/benchmarks/ratelimit.bench.ts` measures throughput (req/s) and per-request overhead (ns) against `InMemoryRateLimitStore`, emitting JSON for evidence capture.

### Phase 3 — Security_Headers_Middleware (extends `security/headers.ts`, R4)

`computeSecurityHeaders` already emits CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` with same-origin/deny defaults (R4.2/4.3). This phase adds **explicit per-header disable** (R4.5) and confirms override semantics (R4.4).

```ts
export type SecurityHeaderName =
  | 'Content-Security-Policy' | 'Strict-Transport-Security'
  | 'X-Frame-Options' | 'X-Content-Type-Options'
  | 'Referrer-Policy' | 'Permissions-Policy';

export interface SecurityHeadersOptions {
  csp?: CspDirectives | false;
  hstsMaxAge?: number;
  frameOptions?: 'DENY' | 'SAMEORIGIN';
  referrerPolicy?: string;
  permissionsPolicy?: string;
  /** Explicitly omit named headers from the response (R4.5). */
  disable?: SecurityHeaderName[];
}
```

- **Override (R4.4):** a supplied option value replaces the default for that header.
- **Disable (R4.5):** names in `disable` (and existing `false`/`0` sentinels) are omitted.
- **Set invariance (R4.6):** with default config the *set of header names* is constant across routes/bodies — `computeSecurityHeaders({})` is a pure function of options only, independent of request/response content (property below).

### Phase 4 — Upload_Guard (`multipart/upload-guard.ts`, wraps `multipart/parser.ts`, R5)

`MultipartParser` already streams files to disk with a random stored name (`randomBytes(16) + '_' + sanitizeFileName`) and enforces a byte cap during streaming. `Upload_Guard` is a **post-parse validation layer** that consumes `ParsedFile[]` and applies type/authenticity/size policy, plus an optional EXIF-strip and malware hook, before the file is considered persisted.

```ts
export interface UploadPolicy {
  maxBytes: number;                         // R5.2
  imageOnly?: boolean;                       // R5.5
  allowedMimeTypes?: string[];               // declared-vs-true match set (R5.4)
  stripExif?: boolean;                       // R5.6
  malwareScan?: (file: ParsedFile) => Promise<{ malicious: boolean; reason?: string }>; // R5.7/5.8
}

export interface UploadGuardResult {
  accepted: ParsedFile & { detectedMime: string; storedName: string };
}

export class UploadRejected extends Error {
  readonly status: 413 | 415;               // size vs type rejection
  readonly code: 'TOO_LARGE' | 'MIME_MISMATCH' | 'DISALLOWED_TYPE' | 'MALWARE';
}

export class UploadGuard {
  constructor(policy: UploadPolicy);
  /** Detect true format from magic bytes (R5.3). */
  detectFormat(head: Buffer): { mime: string } | null;
  /** Validate one parsed file; throws UploadRejected and unlinks on failure. */
  guard(file: ParsedFile): Promise<UploadGuardResult>;
}
```

- **Size (R5.2):** files exceeding `maxBytes` are rejected `413` and the temp file from the parser is `unlink`ed (not persisted).
- **Magic bytes (R5.3/5.4):** `detectFormat` reads leading bytes (e.g. `FF D8 FF` JPEG, `89 50 4E 47` PNG, `47 49 46` GIF, `25 50 44 46` PDF). If detected MIME ≠ declared `mimeType`, reject `415`.
- **Image-only (R5.5):** when enabled, a non-image magic signature is rejected `415`.
- **EXIF strip (R5.6):** in strip mode, image bytes are rewritten to drop EXIF/APP1 segments; output contains no EXIF marker.
- **Malware hook (R5.7/5.8):** the hook is invoked for each accepted file before persistence; a malicious verdict rejects and unlinks.
- **Secure filename (R5.9):** the stored name is derived from `randomBytes` (reusing the parser's scheme) and never contains path separators or the client filename.

### Phase 5 — EncryptedField (`security/encrypted-field.ts`, R6)

Reuses the AES-256-GCM layout already proven in `vault.ts`/`session.ts`, layered with **envelope encryption** (per-value DEK wrapped by a versioned KEK keyring) so KEK rotation does not require re-encrypting historical data (R6.6).

```ts
export interface KeyringEntry { version: number; kek: Buffer /* 32 bytes */; }

/** Versioned KEK set; the highest version is "current" for new writes. */
export class Keyring {
  constructor(entries: KeyringEntry[]);
  current(): KeyringEntry;
  get(version: number): KeyringEntry | undefined;   // for decrypt of old data (R6.6)
}

/** Serialized ciphertext envelope (stored value). */
export interface EncryptedEnvelope {
  v: number;            // KEK version used to wrap the DEK (R6.5/6.6)
  wrappedDek: string;   // base64: GCM(KEK, DEK)
  iv: string;           // base64 data IV
  tag: string;          // base64 data auth tag (R6.7)
  ct: string;           // base64 ciphertext (R6.2)
}

/** Branded type marking a field as encrypted-at-rest (R6.1). */
export type EncryptedField<T> = { readonly __enc: 'EncryptedField'; envelope: EncryptedEnvelope; __t?: T };

export class FieldCipher {
  constructor(keyring: Keyring);
  /** Generate a DEK, AES-256-GCM the plaintext, wrap the DEK under current KEK (R6.2/6.5). */
  encrypt<T>(value: T): EncryptedField<T>;
  /** Unwrap DEK with the envelope's KEK version, decrypt; throw on tamper (R6.3/6.6/6.7). */
  decrypt<T>(field: EncryptedField<T>): T;
}
```

- **Round-trip (R6.3/6.4):** `decrypt(encrypt(x)) === x` for all supported plaintext (JSON-serializable) values (property below).
- **Rotation (R6.6):** adding a higher KEK version makes it current for new writes; old envelopes carry `v` so their DEK is still unwrappable.
- **Tamper detection (R6.7):** altering `ct`/`tag`/`wrappedDek` causes the GCM `final()` to throw; `decrypt` surfaces an error and never returns plaintext.

### Phase 6 — Abuse_Engine (`security/abuse.ts`, R7)

A counter-backed engine consulted by the auth path (composes `jwt.ts`/`session.ts`/`auth/*`). Uses the same `RateLimitStore`-style counter abstraction so it can run in-memory or Redis-backed.

```ts
export interface AbuseConfig {
  loginFailureThreshold: number; loginWindowMs: number; lockoutMs: number;   // R7.1/7.2
  signupThreshold: number; signupWindowMs: number;                            // R7.3
  sprayDistinctAccounts: number; sprayWindowMs: number;                       // R7.4
  scoreThreshold: number;                                                     // R7.6
}

export interface AuthSignal { ip: string; accountId?: string; failed: boolean; ts: number; }

export interface AbuseDecision {
  allowed: boolean;
  reason?: 'LOCKED_OUT' | 'SIGNUP_THROTTLED' | 'SCORE_EXCEEDED';
  retryAfterMs?: number;
  score: number;
}

export class AbuseEngine {
  constructor(cfg: AbuseConfig, store: CounterStore, ipReputation?: (ip: string) => Promise<number>);
  recordLoginAttempt(signal: AuthSignal): Promise<AbuseDecision>;  // R7.1/7.2/7.5/7.6
  recordSignupAttempt(ip: string, ts: number): Promise<AbuseDecision>; // R7.3
  isLockedOut(accountId: string, now: number): Promise<boolean>;   // R7.2
  detectPasswordSpray(ip: string, now: number): Promise<boolean>;  // R7.4
  score(signal: AuthSignal): Promise<number>;                      // R7.5 (incl. IP reputation hook R7.7)
}
```

- **Lockout (R7.1/7.2):** when failed-login count for an account reaches the threshold within the window, the account enters lockout for `lockoutMs`; during lockout, attempts are refused with a lockout-indicating decision.
- **Signup throttle (R7.3):** per-source signup count over threshold within window throttles further signups.
- **Password spray (R7.4):** failed logins spanning ≥ `sprayDistinctAccounts` distinct accounts from one source within the window classify as spray.
- **Scoring + response (R7.5/7.6):** `score()` combines configured signals (incl. the IP-reputation hook, R7.7); reaching `scoreThreshold` triggers the configured response action.

### Phase 7 — Moderation_Toolkit (`security/moderation.ts`, R8)

Report/block/mute APIs over a pluggable store, an exposed moderation queue, and an **append-only audit log** (composes the patterns in `auth/audit-writer.ts`).

```ts
export interface Report { id: string; reporter: string; target: string; reason: string; createdAt: number;
  resolution?: { moderator: string; outcome: string; resolvedAt: number }; }
export interface AuditEvent { readonly id: string; readonly actor: string; readonly target: string;
  readonly action: 'report'|'block'|'mute'|'resolve'; readonly ts: number; } // immutable (R8.5/8.7)

export interface ModerationStore {
  appendAudit(e: AuditEvent): Promise<void>;     // append-only; no update/delete exposed (R8.7)
  listAudit(): Promise<readonly AuditEvent[]>;
  saveReport(r: Report): Promise<void>; listQueue(): Promise<Report[]>;
  setBlock(a: string, b: string): Promise<void>; isBlocked(from: string, to: string): Promise<boolean>;
  setMute(muter: string, muted: string): Promise<void>; isMuted(muter: string, muted: string): Promise<boolean>;
}

export class ModerationToolkit {
  constructor(store: ModerationStore);
  report(reporter: string, target: string, reason: string): Promise<Report>;  // R8.1
  block(a: string, b: string): Promise<void>;                                  // R8.2
  /** B may message A iff NOT (A blocked B) (R8.3). */
  canMessage(from: string, to: string): Promise<boolean>;
  mute(muter: string, muted: string): Promise<void>;                           // R8.4
  /** Filter a recipient's feed, suppressing muted senders only for that recipient (R8.4). */
  deliverable(recipient: string, items: {sender: string}[]): Promise<{sender: string}[]>;
  queue(): Promise<Report[]>;                                                  // R8.6
  resolve(moderator: string, reportId: string, outcome: string): Promise<void>;// R8.6
  audit(): Promise<readonly AuditEvent[]>;                                     // R8.5
}
```

- **Audit immutability (R8.5/8.7):** every report/block/mute/resolve appends an `AuditEvent`; the public API exposes only append + list, no mutation path, so recorded events cannot be modified through it (property below).
- **Block prevents messaging (R8.3):** `canMessage(B, A)` is false while A→B block exists (property below).
- **Mute scoping (R8.4):** muted content is suppressed only in the muting user's `deliverable` view; other recipients are unaffected.

### Phase 8 — SecretProvider (`security/secret-provider.ts`, builds on `vault.ts`, R9)

A single interface with adapters; `vault.ts`'s decrypt/required-var behavior is reused for the local/env adapter and startup enforcement.

```ts
export interface SecretProvider {
  /** Retrieve a secret by name through the configured adapter (R9.3). */
  get(name: string): Promise<string>;
  /** Refresh-on-read: rotated values appear on next get without restart (R9.6). */
}

export class GitHubSecretsProvider implements SecretProvider {}
export class AwsSecretsManagerProvider implements SecretProvider {}
export class AzureKeyVaultProvider implements SecretProvider {}
export class GcpSecretManagerProvider implements SecretProvider {}

/** Redaction registry: values returned by providers are registered so the
 *  Core_Package logger masks them, including in startup error handlers (R9.4). */
export function registerSecretForRedaction(value: string): void;
export function redact(line: string): string;

/** Required-secret startup gate (R9.5): missing required secret → exit non-zero,
 *  emit the NAME only (never the value), reusing vault's required-var pattern. */
export function requireSecrets(provider: SecretProvider, names: string[]): Promise<Record<string,string>>;
```

- **Single interface + adapters (R9.2):** all four providers implement `SecretProvider`.
- **Log redaction (R9.4):** retrieved values are registered and masked by the core logger everywhere, including startup error paths.
- **Required-at-startup (R9.5):** `requireSecrets` fails fast with a non-zero exit and emits only the missing name.
- **No-cache / TTL refresh (R9.6):** providers either do not cache or honor a short TTL so a rotated upstream value is observed on the next `get()` without restart.

### Phase 9 — Privacy_Controls (`security/privacy.ts`, R10)

```ts
export interface PersonalDataSource { collect(userId: string): Promise<Record<string, unknown>>;
  erase(userId: string): Promise<void>; }              // registered per data domain

export interface RetentionPolicy { recordType: string; maxAgeMs: number; }
export interface ConsentDecision { userId: string; purpose: string; granted: boolean; ts: number; }

export class PrivacyControls {
  registerSource(s: PersonalDataSource): void;
  exportData(userId: string): Promise<Record<string, unknown>>;          // R10.1
  deleteAccount(userId: string): Promise<void>;                          // R10.2
  enforceRetention(now: number): Promise<{ removed: number }>;           // R10.3/10.4 (one cycle)
  setConsent(d: ConsentDecision): void;                                  // R10.5
  hasConsent(userId: string, purpose: string): boolean;                  // R10.6
  /** Throws if consent for purpose is withdrawn (R10.6). */
  requireConsent(userId: string, purpose: string): void;
}
```

- **Deletion invariant (R10.2):** after `deleteAccount(u)`, every registered source returns no personal data for `u` (property below).
- **Retention (R10.3/10.4):** `enforceRetention` removes records older than their `maxAgeMs` on the cycle in which they elapse.
- **Consent (R10.5/10.6):** decisions are recorded with purpose + timestamp; withdrawn consent makes `requireConsent` refuse purpose-dependent processing.

### Phase 10 — Dating_Reference_Module (four packages under `packages/`, R11)

Each package mirrors the existing `@streetjs/plugin-*` layout (`package.json` with `main`/`types`/`exports`, `src/index.ts`, README, tests, `examples/`) and depends on `@streetjs/core`.

- **`@streetjs/dating-auth` (R11.7):** wraps core `JwtService`/`SessionManager` + `AbuseEngine`; introduces no independent auth logic.
- **`@streetjs/dating-profiles` (R11.2):** profile creation + likes; records a `Match` when two users have mutually liked.
- **`@streetjs/dating-messaging` (R11.3/11.5):** messaging between matched users; message content stored via `EncryptedField`; refuses messaging while a block exists.
- **`@streetjs/dating-moderation` (R11.4):** blocking/reporting built on `ModerationToolkit`.

```ts
// @streetjs/dating-profiles
export interface Profile { userId: string; displayName: string; bio: EncryptedField<string>; }
export class ProfileService {
  create(p: { userId: string; displayName: string; bio: string }): Promise<Profile>;
  like(from: string, to: string): Promise<{ matched: boolean }>;  // match iff reciprocal (R11.2)
  isMatch(a: string, b: string): Promise<boolean>;
}
// @streetjs/dating-messaging
export class MessageService {
  constructor(profiles: ProfileService, moderation: ModerationToolkit, cipher: FieldCipher);
  send(from: string, to: string, body: string): Promise<{ delivered: boolean; reason?: string }>; // R11.3/11.5
}
```

### R1/R12 — Certification harness (`verification/certification.ts`, extends existing aggregator)

This is the heart of the Zero-Trust Standard and the Certification Report. It **reuses the existing `verification/` subsystem unchanged** and adds a consumer-platform capability set + category roll-up.

How executed-command evidence is captured and aggregated:

1. **Capture (R1.3/1.4, R12.5).** During task execution, each feature's verification step is run through the existing `CommandRunner.run({ capabilityId, command, evidenceHints, outDir })`. The runner spawns the real command (build, test, lint, example run), enforces the timeout, derives the four `EvidenceComponents` (`sourceCode`, `passingTests`, `documentation`, `artifact`), calls the pure `classify()` engine, and writes an atomic `<capabilityId>.artifact.json`. The artifact records the exact `command`, `exitCode`, `timestamp`, and a `generator` block (its presence marks the artifact as command-produced rather than hand-authored). No code in this design writes a status by hand.

2. **Capability set (R1.5).** A frozen list `CONSUMER_PLATFORM_CAPABILITIES` enumerates one dotted capability id per feature/phase (e.g. `validation.runtime`, `ratelimit.sliding-window`, `headers.defaults`, `upload.guard`, `encryption.field`, `abuse.engine`, `moderation.toolkit`, `secrets.provider`, `privacy.controls`, `dating.auth`, `dating.profiles`, `dating.messaging`, `dating.moderation`). The Zero-Trust Standard applies uniformly to all of them.

3. **Category scorecard (R12.1/12.2/12.3/12.4).** A new `computeCertification(artifacts)` (sibling to the existing `computeLeadership`) maps each capability to one or more of the eight report categories — Security, Privacy, Abuse Prevention, Authentication, Moderation, Developer Experience, Enterprise Readiness, Production Readiness — and derives each category's status **solely from recorded artifacts** using the same rules as `aggregator.ts`: a capability with no artifact is treated as not `VERIFIED` (`NOT_IMPLEMENTED`); a category is fully certified iff every contributing capability is `VERIFIED`, otherwise it is reported not-fully-certified with the offending capabilities listed.

```ts
export const CONSUMER_PLATFORM_CAPABILITIES: readonly string[];

export type ReportCategory =
  | 'Security' | 'Privacy' | 'Abuse Prevention' | 'Authentication'
  | 'Moderation' | 'Developer Experience' | 'Enterprise Readiness' | 'Production Readiness';

export interface CategoryStatus {
  category: ReportCategory;
  fullyCertified: boolean;
  contributing: CapabilityStatus[];   // reuses aggregator's CapabilityStatus
  unverified: CapabilityStatus[];     // R12.3 list
}

export interface CertificationReport {
  categories: CategoryStatus[];       // R12.1
  timestamp: string;
  computedFrom: string[];             // artifact paths = evidence references (R12.4)
}

/** Pure (apart from timestamp); derived only from recorded artifacts (R12.4/12.5). */
export function computeCertification(
  artifacts: ReadonlyArray<VerificationArtifact | ArtifactSource>,
  now?: Date,
): CertificationReport;
```

## Data Models

### Validation (R2)
- `RouteSchemas` — per-source Zod schemas. Parsed output stored at `ctx.state.valid[source]`.
- `ValidationError { status: 400; issues: FieldIssue[] }`, `FieldIssue { path; message }`.

### Rate limiting (R3)
- Sliding-window entry: `(key, timestampsMs[])` in memory; Redis sorted set `ZSET key {score: ms, member: id}`.
- `ScopedRateLimitOptions` keyed by `scope` → effective key = `global` | client IP | resolved user id.

### Encryption (R5/R6)
- `EncryptedEnvelope { v, wrappedDek, iv, tag, ct }` (all base64) — the at-rest representation of `EncryptedField<T>`.
- `Keyring` = ordered `KeyringEntry { version, kek }`; current = max version.

### Moderation (R8)
- `Report { id, reporter, target, reason, createdAt, resolution? }`.
- `AuditEvent { id, actor, target, action, ts }` — `readonly` fields; append-only store.
- Block relation: set of `(from,to)` pairs; Mute relation: set of `(muter,muted)` pairs.

### Privacy (R10)
- `RetentionPolicy { recordType, maxAgeMs }`; `ConsentDecision { userId, purpose, granted, ts }` (latest decision per `(userId,purpose)` wins).

### Dating (R11)
- `Profile { userId, displayName, bio: EncryptedField<string> }`; `Like (from,to)`; `Match` iff reciprocal likes; `Message { from, to, body: EncryptedField<string>, ts }`.

### Certification (R1/R12)
- Reuses `VerificationArtifact` (`verification/artifact.ts`) unchanged.
- `CategoryStatus` / `CertificationReport` as above; `computedFrom` carries artifact paths as the evidence reference set.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The following properties were derived from the EARS acceptance criteria via the prework analysis. Redundant criteria were consolidated (e.g. the six rate-limit header/threshold criteria fold into one threshold property; the encryption persistence/read/round-trip/envelope criteria fold into one round-trip property; the dating block criterion R11.5 is the same invariant as R8.3 exercised at the messaging layer). Each property is implemented by a single property-based test (`fast-check`, minimum 100 runs) tagged with **Feature: consumer-platform-security, Property N**.

### Property 1: Validation determinism and conforming pass-through

*For any* Validation_Schema and *any* input value that conforms to it, validating the value returns a value structurally equal to the schema-parsed value, and validating the same input repeatedly always returns structurally equal results.

**Validates: Requirements 2.2, 2.9**

### Property 2: Invalid input is rejected safely before the handler runs

*For any* Validation_Schema and *any* input value that does not conform to it, validation rejects with HTTP status 400, the route handler is never invoked, the serialized `ValidationError` lists a field path and reason for each violated field, and the response body contains no stack trace or internal type information.

**Validates: Requirements 2.3, 2.4, 2.5**

### Property 3: Startup never emits secret/variable values

*For any* declared environment variable or CLI argument whose value fails its Validation_Schema, startup terminates with a non-zero exit code and the emitted output contains the failing variable's name but never its value.

**Validates: Requirements 2.8**

### Property 4: Window-duration parsing is correct

*For any* human-readable window duration string (e.g. `"30s"`, `"1m"`, `"2h"`), `parseWindow` returns the equivalent number of milliseconds.

**Validates: Requirements 3.7**

### Property 5: Sliding-window rate-limit threshold behavior

*For any* configured maximum `M` and window `W`, and *any* sequence of timestamped requests for a key: every request whose count of prior in-window hits is below `M` is permitted and carries an `X-RateLimit-Remaining` header equal to the leftover allowance; the request that reaches `M` and any further request within the window is rejected with HTTP 429 and a `Retry-After` header expressing a positive number of seconds; and requests whose prior hits have aged out of `W` are counted as permitted again.

**Validates: Requirements 3.3, 3.4, 3.5, 3.6**

### Property 6: Security-header set invariance with override and disable

*For any* route, response body, and supplied options under default configuration, the set of security-header names produced by `computeSecurityHeaders` is identical and independent of request/response content; *for any* supplied header value the output uses the supplied value in place of the default; and *for any* set of explicitly disabled header names those names are absent from the output.

**Validates: Requirements 4.2, 4.4, 4.5, 4.6**

### Property 7: Oversize uploads are rejected and not persisted

*For any* uploaded file and configured `maxBytes`, the Upload_Guard accepts the file only when its size is at most `maxBytes`; a file exceeding `maxBytes` is rejected with HTTP 413 and its temporary file is removed (not persisted).

**Validates: Requirements 5.2**

### Property 8: Upload type enforcement from magic bytes

*For any* uploaded file, the Upload_Guard determines the true format from the file's Magic_Byte_Signature independent of the declared MIME type; the file is accepted only when the detected format matches the declared MIME type and (when image-only mode is enabled) the detected format is an allowed image format; otherwise the upload is rejected with HTTP 415.

**Validates: Requirements 5.3, 5.4, 5.5**

### Property 9: EXIF stripping removes all EXIF segments

*For any* accepted image containing EXIF metadata, the stored image produced in EXIF-stripping mode contains no EXIF metadata segments.

**Validates: Requirements 5.6**

### Property 10: Malware verdict prevents persistence

*For any* accepted upload, the configured malware-scan hook is invoked before persistence, and *for any* file the hook reports as malicious the upload is rejected and the file is not persisted.

**Validates: Requirements 5.7, 5.8**

### Property 11: Stored filename is always safe

*For any* client-supplied filename (including path-traversal and separator payloads), the generated stored filename contains no path separators and does not contain the client-supplied filename.

**Validates: Requirements 5.9**

### Property 12: Field-encryption round-trip

*For any* supported plaintext value, encrypting then decrypting the value under a given keyring returns a value equal to the original plaintext, the stored envelope's ciphertext is not equal to the plaintext, and the envelope carries a wrapped Data_Encryption_Key together with the Key_Encryption_Key version used.

**Validates: Requirements 6.2, 6.3, 6.4, 6.5**

### Property 13: Key rotation preserves decryptability

*For any* value encrypted under a Key_Encryption_Key version, after a new Key_Encryption_Key version is added and becomes current, decrypting the previously encrypted value still returns the original plaintext.

**Validates: Requirements 6.6**

### Property 14: Tamper detection

*For any* encrypted envelope and *any* single-byte mutation of its ciphertext, authentication tag, or wrapped Data_Encryption_Key, decryption fails with an error and returns no plaintext.

**Validates: Requirements 6.7**

### Property 15: Login lockout threshold

*For any* account, when the number of failed login attempts within the configured window reaches the configured threshold the account is placed into Account_Lockout for the configured duration, and while locked out every authentication attempt for that account is refused with a lockout-indicating response.

**Validates: Requirements 7.1, 7.2**

### Property 16: Signup throttling threshold

*For any* source, when the number of signup attempts within the configured window reaches the configured threshold, further signup attempts from that source are throttled.

**Validates: Requirements 7.3**

### Property 17: Password-spray classification

*For any* source, when failed logins span at least the configured number of distinct accounts within the configured window, the activity is classified as a password-spray pattern; otherwise it is not.

**Validates: Requirements 7.4**

### Property 18: Block prevents messaging

*For any* pair of users, while a block relationship from user A to user B exists, user B is unable to send messages to user A; absent such a block, messaging is permitted. This invariant holds both in the Moderation_Toolkit and in the `@streetjs/dating-messaging` layer that composes it.

**Validates: Requirements 8.3, 11.5**

### Property 19: Mute scoping

*For any* set of content items and mute relationships, content from a muted user is suppressed from the muting user's delivered view while remaining deliverable to every other recipient.

**Validates: Requirements 8.4**

### Property 20: Audit-event immutability

*For any* sequence of public moderation operations (report, block, mute, resolve), each operation appends exactly one Audit_Event recording actor, target, action, and timestamp, and every previously recorded Audit_Event remains unchanged — the public API only appends to the audit log and never modifies prior events.

**Validates: Requirements 8.5, 8.7**

### Property 21: Deletion removes all personal data

*For any* user and *any* personal data seeded across the registered data sources, after an account-deletion request completes for that user, every registered source returns no personal data for that user.

**Validates: Requirements 10.2**

### Property 22: Retention enforcement removes exactly expired records

*For any* set of records with assigned ages and a configured retention policy, running a retention enforcement cycle removes exactly those records whose age exceeds their configured retention period and retains the rest.

**Validates: Requirements 10.3, 10.4**

### Property 23: Consent enforcement reflects the latest decision

*For any* user, purpose, and sequence of consent grant/withdraw decisions (each recorded with purpose and timestamp), `requireConsent` refuses purpose-dependent processing if and only if the latest recorded decision for that purpose is a withdrawal.

**Validates: Requirements 10.5, 10.6**

### Property 24: Reciprocal likes produce a match

*For any* sequence of likes between users, a match is recorded for a pair if and only if both users in the pair have liked each other.

**Validates: Requirements 11.2**

## Error Handling

- **Validation (R2):** `ValidationError` carries HTTP 400 and a sanitized `issues` list. The router error handler serializes `error.toResponse()` only; stack traces and internal types are never written to the response body (R2.5). Startup validation failures call `process.exit(1)` after printing failing **names** to stderr (R2.8).
- **Rate limiting (R3):** over-limit requests throw `RateLimitException` (existing, HTTP 429) with `Retry-After`. Backing-store failures (e.g. Redis unavailable) fail **closed or open per configuration**; the default in-memory store cannot fail this way. A `RedisRateLimitStore` connection error surfaces a typed error and the middleware falls back to permit-with-warning only when explicitly configured to (documented, security-relevant default is fail-closed).
- **Uploads (R5):** `UploadRejected` distinguishes `413` (size) from `415` (type/MIME/image-only) and always unlinks the parser's temporary file on rejection so rejected files are never persisted. Malware-hook errors are treated as rejection (fail-closed).
- **Encryption (R6):** `decrypt` throws on any GCM authentication failure (tampered `ct`/`tag`/`wrappedDek`) and never returns partial plaintext; missing KEK version in the keyring throws a descriptive error. This mirrors the existing `vault.decryptSecret`/`session.decrypt` fail-safe behavior.
- **Abuse (R7):** lockout and throttle decisions are returned as structured `AbuseDecision` values (not thrown) so the auth layer chooses the HTTP response; `isLockedOut` is consulted before credential verification.
- **Moderation (R8):** the store exposes no update/delete for audit events; attempts to mutate are impossible through the public API by construction (no method exists). Resolution updates touch `Report` records only, never `AuditEvent`s.
- **Secrets (R8/R9):** retrieval failure for a **required** secret terminates startup non-zero emitting only the name (R9.5); retrieved values are registered for redaction so the logger masks them everywhere, including startup error handlers (R9.4).
- **Privacy (R10):** `requireConsent` throws a typed `ConsentRequiredError` when the relevant purpose has been withdrawn (R10.6); export/delete operations are idempotent and safe to retry.
- **Certification (R1/R12):** the existing `CommandRunner` already classifies timeouts and missing prerequisites as `BLOCKED`, writes artifacts atomically, and throws (leaving no partial artifact) on write failure. The new `computeCertification` is pure and never throws; a missing artifact yields a not-fully-certified category with the capability listed (R12.3).

## Testing Strategy

This feature is well suited to property-based testing for its pure, input-varying logic, and the repo already standardizes on `fast-check` with `node --test` (see `packages/core/src/tests/*-pbt.test.ts`). The strategy is dual: property tests for universal behavior, example/integration/smoke tests for everything else.

**Property-based tests (PBT):**
- Library: `fast-check` (already a dev dependency of `@streetjs/core`).
- Each of the 24 Correctness Properties is implemented by exactly one property-based test, minimum **100 iterations**, located under `packages/core/src/tests/` (and the respective Phase 10 packages for Properties 18 and 24) following the existing `*-pbt.test.ts` naming.
- Each test is tagged with a comment: **Feature: consumer-platform-security, Property N: {property text}**, and references the requirement IDs it validates.
- Stateful subsystems (rate limiter, abuse engine, moderation) are tested against the `InMemory*` store implementations with an **injected clock** so window/lockout/retention timing is deterministic under generated timestamps.

**Example-based unit tests:**
- Per-source schema acceptance (R2.1), env/CLI happy path (R2.7), default header values (R4.3), each rate-limit scope (R3.2), malware-hook ordering (R5.7), suspicious-score computation and response action (R7.5/7.6), IP-reputation consultation (R7.7), report-store-and-queue and queue resolution (R8.1/8.6), block records relationship (R8.2), data export contents (R9.1).

**Integration tests (1–3 examples, not PBT):**
- `RedisRateLimitStore`, `RedisModerationStore`, and abuse counters against a real/mocked Redis to prove cross-instance consistency (R3.8); these are infrastructure-bound and do not vary meaningfully per input.
- `SecretProvider` adapters (GitHub/AWS/Azure/GCP) against mocked SDKs to verify retrieval and rotation-on-next-read (R9.2/9.3/9.6) and log redaction (R9.4).
- Upload storage to S3/R2 via the existing plugins for accepted files.
- Certification: `computeCertification` over crafted artifact sets verifying category statuses, the unverified list when a contributing capability has no artifact, and that `computedFrom` references the evidence paths (R12.1–12.4).

**Smoke / type tests:**
- Type-level inference of handler parameters from schemas (R2.6).
- Extension assertions confirming new code builds on existing modules (R3.1, R4.1, R5.1, R8.1-secrets, R9.1, R10.3/10.4-dating, R10.7).
- Four Phase-10 packages build and export their public API (R11.1, R11.6).
- Rate-limit benchmark harness runs and emits metrics JSON (R3.9).

**Zero-Trust evidence capture (R1, R12):**
- Every feature's verification step is executed through the existing `CommandRunner.run({ capabilityId, command, evidenceHints, outDir })` during task execution. The runner spawns the real command (build, `node --test`, lint, example run), derives the four evidence components, classifies a status via the pure `classify()` engine, and writes an atomic `<capabilityId>.artifact.json`.
- After all capabilities run, `computeCertification` aggregates the recorded artifacts into the eight-category scorecard, deriving every status solely from artifacts and referencing the artifact paths as evidence.
- No `VERIFIED` status or scorecard verdict is written into this design or the requirements; statuses exist only as the product of executed-command evidence captured during task execution.
