# Implementation Plan: Consumer Platform Security

## Overview

This plan incrementally implements the ten-phase consumer-platform-security design under the Zero-Trust Certification Standard (R1). It follows the design's **extend-don't-replace** strategy: new capabilities are added to existing modules (`security/ratelimit.ts`, `security/headers.ts`, `multipart/parser.ts`, `security/vault.ts`, `verification/aggregator.ts`) or as sibling modules in `packages/core/src/security/` that compose existing primitives, all re-exported from `packages/core/src/index.ts`.

Implementation language is **TypeScript** (existing `@streetjs/core` monorepo). Tests use `node --test` with `fast-check`, following the existing `packages/core/src/tests/*-pbt.test.ts` naming convention (minimum 100 iterations per property). Each property-based test is tagged `Feature: consumer-platform-security, Property N` and references the requirement IDs it validates.

Foundational pieces (backing-store abstraction, Validator) come first, then each phase, then the Phase 10 dating packages that compose earlier primitives, then the certification aggregation that produces the final scorecard from real executed-command evidence.

Per the Zero-Trust Standard, each feature's definition of done is: source implementation, public exports from `index.ts`, documentation, automated tests, passing build, green existing suites, and executed-command evidence captured via the existing `CommandRunner`. Export wiring, documentation, test execution, and evidence capture are explicit tasks below.

## Tasks

- [x] 1. Implement the pluggable backing-store abstraction
  - [x] 1.1 Create the shared store abstraction in new `packages/core/src/security/store.ts`
    - Define `KeyValueStore` and `CounterStore` interfaces and the `RateLimitStore` interface (`hit(key, nowMs, windowMs)`, `count(key, nowMs, windowMs)`) per the design
    - Implement `InMemoryRateLimitStore` by extracting/reusing the current Map-based sliding-window logic so it is interchangeable with a future Redis-backed store
    - Support an injected clock (now-provider) so window timing is deterministic in tests
    - _Requirements: 3.8_
  - [x] 1.2 Write unit tests for `InMemoryRateLimitStore`
    - Cover hit/count semantics, window roll-off, and clock injection in a new `packages/core/src/tests/store.test.ts`
    - _Requirements: 3.8_

- [x] 2. Implement Phase 1 — Runtime Input Validator
  - [x] 2.1 Add the Zod dependency and implement the Validator in new `packages/core/src/security/validation.ts`
    - Add `zod` to `packages/core/package.json` dependencies
    - Implement `RouteSchemas`, `InputSource`, `FieldIssue`, `ValidationError` (status 400, `toResponse()` emitting only `{path, message}` with no stack/internal types)
    - Implement `validate(schemas): MiddlewareFn` that parses each declared source before calling `next()` so the handler never runs on failure, writing parsed values to `ctx.state.valid.<source>`
    - Implement `validated(ctx, schemas)` typed accessor (inferred handler types), `validateEnv` and `validateArgv` that collect failing names, print names to stderr, and `process.exit(1)` without emitting values
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
  - [x] 2.2 Write property test for validation determinism and pass-through
    - **Property 1: Validation determinism and conforming pass-through**
    - **Validates: Requirements 2.2, 2.9**
    - `packages/core/src/tests/validation-determinism-pbt.test.ts`, fast-check ≥100 runs
  - [x] 2.3 Write property test for safe rejection before handler execution
    - **Property 2: Invalid input is rejected safely before the handler runs**
    - **Validates: Requirements 2.3, 2.4, 2.5**
  - [x] 2.4 Write property test for startup never emitting secret/variable values
    - **Property 3: Startup never emits secret/variable values**
    - **Validates: Requirements 2.8**
  - [x] 2.5 Write unit tests for per-source acceptance, env/CLI happy path, and type inference
    - Cover each `InputSource` (body/query/params/headers/cookies), startup happy path, and schema-inferred handler parameter types
    - _Requirements: 2.1, 2.6, 2.7_

- [x] 3. Implement Phase 2 — Global Rate Limiting (extend `security/ratelimit.ts`)
  - [x] 3.1 Extend `packages/core/src/security/ratelimit.ts` with scopes, stores, and window parsing
    - Add `parseWindow(window)`, `RateScope`, `ScopedRateLimitOptions`, and the `rateLimit(opts): MiddlewareFn` factory supporting global/per-IP/per-user scopes
    - Wire the limiter to the `RateLimitStore` abstraction (default `InMemoryRateLimitStore`) and add `RedisRateLimitStore` (sorted-set per key) for cross-instance enforcement, preserving the existing sliding-window/`Retry-After`/`X-RateLimit-*` behavior
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  - [x] 3.2 Implement the reproducible rate-limit benchmark harness
    - Create `packages/core/src/benchmarks/ratelimit.bench.ts` measuring throughput (req/s) and per-request overhead, emitting metrics JSON for evidence capture
    - _Requirements: 3.9_
  - [x] 3.3 Write property test for window-duration parsing
    - **Property 4: Window-duration parsing is correct**
    - **Validates: Requirements 3.7**
  - [x] 3.4 Write property test for sliding-window threshold behavior
    - **Property 5: Sliding-window rate-limit threshold behavior**
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6**
  - [x] 3.5 Write unit tests for each rate-limit scope
    - Verify global, per-IP, and per-user keying against `InMemoryRateLimitStore`
    - _Requirements: 3.2_

- [x] 4. Implement Phase 3 — Security Headers (extend `security/headers.ts`)
  - [x] 4.1 Extend `packages/core/src/security/headers.ts` with override and explicit disable
    - Add `SecurityHeaderName`, extend `SecurityHeadersOptions` with `disable[]`, and confirm override semantics so a supplied value replaces the default and disabled names are omitted
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 4.2 Write property test for header-set invariance with override and disable
    - **Property 6: Security-header set invariance with override and disable**
    - **Validates: Requirements 4.2, 4.4, 4.5, 4.6**
  - [x] 4.3 Write unit tests for production-safe default header values
    - Assert default CSP/HSTS/frame/referrer/permissions values restrict to same origin and deny framing
    - _Requirements: 4.3_

- [x] 5. Implement Phase 4 — Media Upload Security (wrap `multipart/parser.ts`)
  - [x] 5.1 Implement `UploadGuard` in new `packages/core/src/multipart/upload-guard.ts`
    - Consume `ParsedFile[]` from `MultipartParser`; implement `detectFormat(head)` (magic bytes for JPEG/PNG/GIF/PDF), `guard(file)`, and `UploadRejected` (413 size, 415 type/mime/image-only/malware)
    - Enforce size cap (unlink temp file on rejection), declared-vs-true MIME match, image-only mode, EXIF stripping, malware-scan hook invoked before persistence (fail-closed), and a random `storedName` with no path separators or client filename
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_
  - [x] 5.2 Write property test for oversize rejection without persistence
    - **Property 7: Oversize uploads are rejected and not persisted**
    - **Validates: Requirements 5.2**
  - [x] 5.3 Write property test for magic-byte type enforcement
    - **Property 8: Upload type enforcement from magic bytes**
    - **Validates: Requirements 5.3, 5.4, 5.5**
  - [x] 5.4 Write property test for EXIF segment removal
    - **Property 9: EXIF stripping removes all EXIF segments**
    - **Validates: Requirements 5.6**
  - [x] 5.5 Write property test for malware-verdict persistence prevention
    - **Property 10: Malware verdict prevents persistence**
    - **Validates: Requirements 5.7, 5.8**
  - [x] 5.6 Write property test for always-safe stored filenames
    - **Property 11: Stored filename is always safe**
    - **Validates: Requirements 5.9**

- [x] 6. Implement Phase 5 — Field-Level Encryption
  - [x] 6.1 Implement `EncryptedField` in new `packages/core/src/security/encrypted-field.ts`
    - Reuse the AES-256-GCM layout from `vault.ts`/`session.ts`; implement `Keyring`, `KeyringEntry`, `EncryptedEnvelope`, the branded `EncryptedField<T>` type, and `FieldCipher` (`encrypt` generates a DEK and wraps it under the current KEK; `decrypt` unwraps by envelope version and throws on tamper)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [x] 6.2 Write property test for the encryption round-trip
    - **Property 12: Field-encryption round-trip**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5**
  - [x] 6.3 Write property test for key-rotation decryptability
    - **Property 13: Key rotation preserves decryptability**
    - **Validates: Requirements 6.6**
  - [x] 6.4 Write property test for tamper detection
    - **Property 14: Tamper detection**
    - **Validates: Requirements 6.7**

- [x] 7. Implement Phase 6 — Abuse Prevention
  - [x] 7.1 Implement `AbuseEngine` in new `packages/core/src/security/abuse.ts`
    - Build a counter-backed engine over the `CounterStore`/`RateLimitStore` abstraction with injected clock; implement `recordLoginAttempt`, `recordSignupAttempt`, `isLockedOut`, `detectPasswordSpray`, and `score` returning structured `AbuseDecision` values, plus the IP-reputation hook
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [x] 7.2 Write property test for login lockout threshold
    - **Property 15: Login lockout threshold**
    - **Validates: Requirements 7.1, 7.2**
  - [x] 7.3 Write property test for signup throttling threshold
    - **Property 16: Signup throttling threshold**
    - **Validates: Requirements 7.3**
  - [x] 7.4 Write property test for password-spray classification
    - **Property 17: Password-spray classification**
    - **Validates: Requirements 7.4**
  - [x] 7.5 Write unit tests for suspicious-score computation and IP-reputation consultation
    - Verify score combination, configured response action triggering, and the IP-reputation hook being consulted
    - _Requirements: 7.5, 7.6, 7.7_

- [ ] 8. Implement Phase 7 — Moderation Toolkit
  - [x] 8.1 Implement `ModerationToolkit` in new `packages/core/src/security/moderation.ts`
    - Implement `ModerationStore` and an `InMemoryModerationStore` plus `ModerationToolkit` (`report`, `block`, `canMessage`, `mute`, `deliverable`, `queue`, `resolve`, `audit`); the audit log is append-only with no public mutation path, composing the patterns in `auth/audit-writer.ts`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 8.2 Write property test for mute scoping
    - **Property 19: Mute scoping**
    - **Validates: Requirements 8.4**
  - [~] 8.3 Write property test for audit-event immutability
    - **Property 20: Audit-event immutability**
    - **Validates: Requirements 8.5, 8.7**
  - [~] 8.4 Write unit tests for report/queue/resolve/block APIs
    - Verify report stored and queued, block records relationship, `canMessage` reflects block, and queue resolution
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

- [ ] 9. Implement Phase 8 — Secrets Management (builds on `security/vault.ts`)
  - [x] 9.1 Implement `SecretProvider` in new `packages/core/src/security/secret-provider.ts`
    - Define the single `SecretProvider` interface and `GitHubSecretsProvider`, `AwsSecretsManagerProvider`, `AzureKeyVaultProvider`, `GcpSecretManagerProvider` adapters; implement `registerSecretForRedaction`/`redact` and `requireSecrets` (startup gate emitting only names, reusing vault's required-var behavior); refresh-on-read so rotated values appear without restart
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [~] 9.2 Write integration tests for adapters against mocked SDKs
    - Verify retrieval, rotation-on-next-read, and log redaction (including startup error paths) for all four adapters
    - _Requirements: 9.2, 9.3, 9.4, 9.6_

- [ ] 10. Implement Phase 9 — Privacy Controls
  - [x] 10.1 Implement `PrivacyControls` in new `packages/core/src/security/privacy.ts`
    - Implement `PersonalDataSource` registration, `exportData`, `deleteAccount`, `enforceRetention` (one cycle), `setConsent`/`hasConsent`/`requireConsent` (latest decision wins, throws `ConsentRequiredError` when withdrawn)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [~] 10.2 Write property test for deletion removing all personal data
    - **Property 21: Deletion removes all personal data**
    - **Validates: Requirements 10.2**
  - [~] 10.3 Write property test for retention enforcement
    - **Property 22: Retention enforcement removes exactly expired records**
    - **Validates: Requirements 10.3, 10.4**
  - [~] 10.4 Write property test for consent enforcement
    - **Property 23: Consent enforcement reflects the latest decision**
    - **Validates: Requirements 10.5, 10.6**

- [ ] 11. Wire core public exports and documentation
  - [~] 11.1 Re-export all new core modules from `packages/core/src/index.ts`
    - Export `validation`, rate-limit additions, header additions, `upload-guard`, `encrypted-field`, `abuse`, `moderation`, `secret-provider`, `privacy`, and the store abstraction next to the existing security/verification exports (satisfies the Zero-Trust "public package exports" condition)
    - _Requirements: 1.1_
  - [~] 11.2 Write documentation for the new core subsystems
    - Add written docs covering Validator, rate-limit scopes/stores, header config, upload guard, field encryption, abuse engine, moderation toolkit, secret providers, and privacy controls (satisfies the Zero-Trust "written documentation" condition)
    - _Requirements: 1.1, 1.5_

- [~] 12. Checkpoint — core phases
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implement Phase 10 — `@streetjs/dating-auth`
  - [~] 13.1 Scaffold and implement the `@streetjs/dating-auth` package under `packages/dating-auth`
    - Mirror the `@streetjs/plugin-*` layout (`package.json` with `main`/`types`/`exports`, `tsconfig.json`, `src/index.ts`, `README.md`, `examples/`); depend on `@streetjs/core` and wrap `JwtService`/`SessionManager`/`AbuseEngine` with no independent auth logic
    - _Requirements: 11.1, 11.6, 11.7_

- [ ] 14. Implement Phase 10 — `@streetjs/dating-profiles`
  - [~] 14.1 Scaffold and implement the `@streetjs/dating-profiles` package under `packages/dating-profiles`
    - Mirror the plugin layout and depend on `@streetjs/core`; implement `ProfileService` (`create`, `like`, `isMatch`) storing `bio` via `EncryptedField` and recording a `Match` on reciprocal likes; include docs, tests, and runnable examples
    - _Requirements: 11.1, 11.2, 11.6_
  - [~] 14.2 Write property test for reciprocal-like matching
    - **Property 24: Reciprocal likes produce a match**
    - **Validates: Requirements 11.2**
    - Located in the `@streetjs/dating-profiles` package tests per the design

- [ ] 15. Implement Phase 10 — `@streetjs/dating-moderation`
  - [~] 15.1 Scaffold and implement the `@streetjs/dating-moderation` package under `packages/dating-moderation`
    - Mirror the plugin layout and depend on `@streetjs/core`; provide blocking and reporting built on `ModerationToolkit`; include docs, tests, and runnable examples
    - _Requirements: 11.1, 11.4, 11.6_

- [ ] 16. Implement Phase 10 — `@streetjs/dating-messaging`
  - [~] 16.1 Scaffold and implement the `@streetjs/dating-messaging` package under `packages/dating-messaging`
    - Mirror the plugin layout and depend on `@streetjs/core` and `@streetjs/dating-profiles`; implement `MessageService.send` allowing messaging only between matched users, storing message content via `EncryptedField`, and refusing messaging while a block exists (composing `ModerationToolkit`); include docs, tests, and runnable examples
    - _Requirements: 11.1, 11.3, 11.5, 11.6_
  - [~] 16.2 Write property test for block preventing messaging at the messaging layer
    - **Property 18: Block prevents messaging**
    - **Validates: Requirements 8.3, 11.5**
    - Located in the `@streetjs/dating-messaging` package tests per the design

- [~] 17. Checkpoint — dating reference packages
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Implement the certification harness (extends `verification/aggregator.ts`)
  - [~] 18.1 Implement `computeCertification` and the capability set in new `packages/core/src/verification/certification.ts`
    - Define the frozen `CONSUMER_PLATFORM_CAPABILITIES`, `ReportCategory`, `CategoryStatus`, and `CertificationReport`; implement the pure `computeCertification(artifacts, now?)` that maps capabilities to the eight categories and derives statuses solely from recorded artifacts (missing artifact ⇒ not `VERIFIED`, listed in `unverified`), reusing `artifact.ts`/`status.ts`/`aggregator.ts`; re-export from `index.ts`
    - _Requirements: 1.5, 12.1, 12.2, 12.3, 12.4_
  - [~] 18.2 Write integration tests for `computeCertification`
    - Over crafted artifact sets, verify category statuses, the unverified list when a contributing capability has no artifact, and that `computedFrom` references the evidence paths
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [ ] 19. Capture Zero-Trust evidence and produce the certification report
  - [~] 19.1 Implement the evidence-capture orchestration script
    - Implement a script that runs each capability's verification step through the existing `CommandRunner.run({ capabilityId, command, evidenceHints, outDir })` (build, `node --test`, lint, example run), writing one atomic `<capabilityId>.artifact.json` per capability so VERIFIED status derives from real executed-command output
    - _Requirements: 1.2, 1.3, 1.4, 12.5_
  - [~] 19.2 Generate the Certification Report from captured artifacts
    - Wire `computeCertification` over the captured artifact set to emit the eight-category scorecard, listing unverified features per not-fully-certified category and referencing artifact paths as evidence
    - _Requirements: 1.1, 12.1, 12.2, 12.3, 12.4, 12.5_

- [~] 20. Final checkpoint — full certification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement sub-clauses for traceability, and each property-based test task references its design Property number and the requirements it validates.
- All 24 correctness properties are covered: P1–P3 (validation), P4–P5 (rate limiting), P6 (headers), P7–P11 (uploads), P12–P14 (encryption), P15–P17 (abuse), P18 (block-prevents-messaging, in dating-messaging), P19–P20 (moderation), P21–P23 (privacy), P24 (reciprocal match, in dating-profiles).
- Property-based tests use `fast-check` with a minimum of 100 iterations and the `*-pbt.test.ts` naming convention, with an injected clock for stateful subsystems.
- Phase 8 secrets have no universal correctness properties in the design and are covered by integration tests against mocked SDKs.
- The certification layer never asserts VERIFIED status; statuses are produced only from executed-command evidence captured by the existing `CommandRunner` during task execution.
- Checkpoints provide incremental validation at natural boundaries (core phases, dating packages, full certification).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "2.4", "2.5", "3.1", "4.1", "5.1", "6.1", "7.1", "8.1", "9.1", "10.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "3.5", "4.2", "4.3", "5.2", "5.3", "5.4", "5.5", "5.6", "6.2", "6.3", "6.4", "7.2", "7.3", "7.4", "7.5", "8.2", "8.3", "8.4", "9.2", "10.2", "10.3", "10.4"] },
    { "id": 3, "tasks": ["11.1", "11.2"] },
    { "id": 4, "tasks": ["13.1", "14.1", "15.1"] },
    { "id": 5, "tasks": ["14.2", "16.1"] },
    { "id": 6, "tasks": ["16.2", "18.1"] },
    { "id": 7, "tasks": ["18.2", "19.1"] },
    { "id": 8, "tasks": ["19.2"] }
  ]
}
```
