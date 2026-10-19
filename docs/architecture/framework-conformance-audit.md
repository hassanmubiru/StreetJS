# StreetJS Framework Conformance Audit

**Audit date:** 2026-10-20  
**Scope:** all 99 packages under `packages/*` plus root build, lockfile,
Docker, and runtime-facing contracts  
**Implementation status:** audit deliverables plus the verified P1 toolchain,
Docker alignment, and verification-command fixes are included below

## Executive result

StreetJS has a strong set of modular runtime contracts and several of the
claimed improvements are present in source and tests. It is not yet fully
conformant with the stated reproducibility objective:

- `npm ci` succeeds.
- `npm run verify` now exists and reports explicit verification stages.
- The clean-install CLI TypeScript mismatch was fixed by pinning the CLI
  compiler range to the API used by its tests.
- Repository Dockerfiles now use pinned Node 22 Alpine builder/runtime images
  where they previously used Node 24.
- SQLite WASM is committed and hash-verified; the build only needs the network
  when the committed asset is absent or invalid.

These are verified findings. Earlier claims that the root build passes are
true only for the previously installed dependency tree, not for a fresh
`npm ci` installation.

## Evidence collected

| Check | Result | Evidence |
|---|---|---|
| Package manifests | PASS | 99 `packages/*/package.json` files inventoried |
| Runtime pin | PARTIAL | `.nvmrc` is `22`; root engines require Node `>=22`, npm `>=10` |
| Clean dependency install | PASS | `npm ci` completed; 5 vulnerabilities reported |
| Root build after clean install | PASS | CLI compiler pin fixed the TypeScript API mismatch |
| Root offline test command | PASS | `npm run verify` runs core and CLI offline suites; PostgreSQL suites are skipped |
| Root `npm run verify` | PASS | BUILD/LINT/TYPECHECK/core+CLI OFFLINE/INTEGRATION pass; external stage explicitly skipped |
| Root lint script | PRESENT | Delegates only to core lint |
| Docker builder/runtime alignment | PASS by static inspection | Dockerfiles now use pinned Node 22 Alpine images; Docker unavailable in this environment |
| Docker network behavior | CONDITIONAL | Committed SQLite WASM is verified before any download; forced regeneration needs network |
| Working tree after audit checks | CLEAN | No source modifications made |

## Phase 1 — package inventory

The complete machine-readable inventory is:

```text
docs/architecture/package-inventory.json
```

It contains, for every package:

- package name and version
- directory
- preliminary layer
- preliminary public-surface classification
- direct application-consumption recommendation
- dependencies and devDependencies
- peer and optional dependencies
- exports and publish files
- static imports from `streetjs`
- static imports from other framework packages
- source/test split and evidence files
- lifecycle resource signals
- build, lint, typecheck, test, verify, and coverage scripts
- external-service environment signals

The inventory is evidence-backed but explicitly labels layer, surface, and
lifecycle classifications as preliminary architectural assessments.

Package surface classification:

| Classification | Count |
|---|---:|
| KEEP PUBLIC | 67 |
| OPTIONAL PUBLIC | 29 |
| INTERNAL | 2 |
| COMPATIBILITY ONLY | 1 |

The repository contains 99 packages because it serves several legitimate
surfaces: core runtime, foundations, data, runtime capabilities, plugins,
client adapters, tooling, UI adapters, and application capabilities. This audit
does not recommend reducing that count.

## Phase 3 — lifecycle/resource ownership

### Verified positive contracts

| Resource | Creator | Owner/close path | Evidence/status |
|---|---|---|---|
| HTTP server | `streetApp()` | `StreetApp.close()`; awaits app-owned container disposal | close and request-scope tests present |
| HTTP/2 server | HTTP/2 app factory | `close()`; awaits app-owned container disposal | close path exists; dedicated conformance coverage should be expanded |
| WebSocket server | `StreetWebSocketServer` | `close()`; heartbeat timer is managed | close implementation and server tests present |
| Queue workers/scheduler/driver | `Queue` facade | `Queue.close()` stops workers, scheduler, then driver; idempotent guard | lifecycle tests present |
| Realtime facade/cluster adapter | realtime facade/plugin | facade/plugin unload closes adapter; memory/Redis adapters expose close | tests cover memory and Redis paths where available |
| Event facade/Redis store | events facade/plugin | `close()` and plugin `onUnload()` | plugin/facade tests present |
| Workflow engine | workflow engine/plugin | `close()` and plugin `onUnload()` | workflow lifecycle tests present |
| Storage facade/observability | storage facade/plugin | `close()` stops observability; plugin unload detaches bridges then awaits close | 374-test storage suite passed before this audit |
| Database pool | `Pool` | `close()` clears sweep timer and closes resources | pool tests cover close behavior |
| Telemetry tracker | `TelemetryTracker` | explicit `destroy()` clears collection timer | source exposes deterministic teardown |
| Plugin resources | plugin host/server sandbox | `addCleanup()` and reverse-order cleanup | plugin host/lifecycle tests present |

### Lifecycle gaps or follow-up evidence needed

1. HTTP/2, WebSocket, gateway, and adapter shutdown paths need to be included
   in one cross-package lifecycle matrix instead of separate package tests.
2. Partial startup failure needs explicit evidence for each long-lived resource;
   some drivers test initialization failure, but the framework has no single
   failure-injection contract spanning HTTP, DI, queue, storage, and telemetry.
3. `@streetjs/telemetry` uses an explicit `destroy()` rather than a common
   `close()`/`dispose()` protocol. This is not automatically wrong, but it
   weakens uniform application shutdown composition.
4. Health/metrics refresh timers are generally owned by facade `close()` paths;
   the ownership contract should be tested through application shutdown, not
   only direct facade closure.

No lifecycle global singleton was introduced or recommended.

## Phase 4 — DI conformance

### Verified

The container implementation provides:

- application isolation through `createContainer()`
- nested scopes through `createScope()`
- singleton, transient, and scoped lifetimes
- class, symbol, and string tokens
- circular dependency detection
- deterministic disposal
- legacy global container compatibility
- idempotent container disposal

Evidence includes `packages/container/src/container.ts` and the container test
suite, including application isolation, request scopes, disposal, and repeated
disposal.

### Gaps

- No unified cross-package contract suite verifies that core, HTTP, HTTP/2,
  gateway, queue, storage, and workflow all observe identical DI lifetime
  semantics.
- Async disposal is supported through awaited `dispose()` calls, but there is
  no explicit `Symbol.asyncDispose` contract.
- Failed-construction cleanup and nested-scope failure behavior need a single
  cross-package regression suite.

Status: **mostly conformant, P2 test-unification gap**.

## Phase 5 — routing conformance

### Verified canonical behavior

The standalone router implements:

- `/users` → match
- `/users/` → no match
- `/` → match
- parameter decoding with `decodeURIComponent`
- wildcard routes
- middleware pipeline execution
- query strings excluded from path matching
- validation of body, query, and params
- envelope or legacy error response modes

Gateway tests cover static, prefix, wildcard, parameter, query, and trailing
slash behavior. Core integration tests cover strict trailing slash behavior.
The core router is a re-export wrapper around `@streetjs/router`.

### Gaps

- A single matrix does not yet prove the same policy through mounted routers,
  HTTP/2, encoded slash edge cases, and all wildcard/prefix combinations.
- Route documentation and generated OpenAPI output should be checked together
  for the strict-slash policy.

No redirect or normalization was introduced.

## Phase 6 — error contract

The `StreetErrorEnvelope` contract is implemented with:

- stable `code`
- `message`
- optional `status`
- optional `details`
- optional `correlationId`
- unknown-error sanitization to `internal_error`

Core and standalone router error paths use `toStreetErrorEnvelope()` when the
envelope mode is selected. Legacy exception JSON remains available.

### Gap

`details` from a known `StreetException` is passed through unchanged. That may
be correct for validation errors, but there is no central redaction policy for
known exceptions. The unknown-error path is sanitized and diagnostics logging
receives the original error, which is the correct general direction.

Status: **conformant for unknown-error secrecy; P2 details-redaction review**.

## Phase 7 — security conformance

Verified areas include:

- JWT algorithm-confusion rejection
- HS256 signature verification
- timing-safe signature comparison
- runtime validation of `sub`, `iat`, `exp`, `nbf`, and `roles`
- issuer and audience checks
- malformed cryptographically valid JWT payload tests
- encrypted-field malformed-token rejection
- timing-safe string comparison
- webhook signature tests
- raw-body preservation for webhook verification
- outbound webhook HTTPS/SSRF guard code
- session encryption and CSRF data paths

Security tests explicitly exercise malformed claims such as non-string roles,
string expiry values, and non-finite numeric claims.

### Follow-up gaps

- The audit should add a single malformed-input matrix covering JWT, sessions,
  cookies, CSRF, webhook signatures, and authorization middleware.
- SSRF coverage should verify DNS rebinding and redirect behavior, not only URL
  scheme/private-address checks.
- Plugin permission boundaries are represented by the sandbox interface, but
  permission enforcement across all plugin capabilities is not centrally
  documented.

Status: **strong core validation; P2 cross-surface security matrix gap**.

## Phase 8 — client auth boundary

`@streetjs/client` is currently storage-agnostic:

- it accepts an optional `getToken()` callback;
- it does not read `localStorage` or `sessionStorage`;
- it supports `AbortSignal` on requests;
- it supports explicit `credentials` configuration;
- logout is an explicit API request.

There is no implicit browser token persistence, which is correct.

There is also no refresh lifecycle abstraction. The current client does not yet
provide `TokenStore`, single-flight refresh, bounded 401 retry, or refresh-loop
prevention. This should remain unimplemented until the API contract is reviewed
against the existing client architecture, as requested.

Status: **storage boundary conformant; optional refresh abstraction pending
design review**.

## Phase 9 — verification matrix

Current root commands are fragmented:

- `npm run build` builds core and CLI only.
- `npm test` runs core offline tests.
- `npm run test:integration` runs core integration tests.
- `npm run lint` lints core only.
- many packages have their own build/test/lint commands.
- `npm run verify` runs the root and workspace verification stages.

The authoritative command prints explicit stages:

1. BUILD
2. LINT
3. TYPECHECK
4. OFFLINE TESTS
5. INTEGRATION TESTS
6. EXTERNAL SERVICE TESTS

Every unavailable service must be reported as `SKIPPED` or `UNAVAILABLE`.

## Phase 10 — reproducibility

### Verified

- `.nvmrc` contains Node `22`.
- Root engines require Node `>=22` and npm `>=10`.
- `package-lock.json` is present.
- `npm ci` completes.
- package dependencies are workspace-local.

### Findings

#### Resolved P1: TypeScript toolchain mismatch

The clean root install previously resolved TypeScript `7.0.2`. The CLI tests
used compiler API members that were not available through the resolved module
shape, and `npm run build` failed with errors for `ModuleKind`, `ScriptTarget`,
and `transpileModule`.

The CLI development dependency is now pinned to `^5.9.3` and the root lockfile
was regenerated. `npm ci && npm run build` now passes.

#### Resolved P1: Docker runtime mismatch

The affected Dockerfiles now use a pinned Node 22 Alpine image, consistent with
the Node 22 `.nvmrc`, root engine declaration, and distroless Node 22 runtime.

#### P2: conditional network-dependent WASM regeneration

The Docker build invokes `download-wasm.mjs`, but the committed
`sqlite3.wasm` is checked against a pinned SHA-256 and exits without network
access when valid. Forced regeneration remains network-dependent and should be
documented as a maintenance operation, not part of the offline verification
path.

#### P2: no root CI workflow discovered

No `.github/workflows/*` files were found during the repository scan. The
project has scripts and Docker compose files, but no checked-in GitHub workflow
was identified to enforce the stated build/test matrix.

## Phase 11 — public-surface review

Preliminary categories are encoded in `package-inventory.json`:

- **KEEP PUBLIC:** core foundations and stable backend capabilities.
- **OPTIONAL PUBLIC:** plugins, client-offline, and UI adapters.
- **COMPATIBILITY ONLY:** core compatibility package.
- **INTERNAL:** registry-server and devtools based on current manifest intent.

No package deletion or merge is recommended. The main external simplification
should come from documentation and root orchestration, not repository surgery.

## Prioritized implementation plan

### P0

No P0 issue was proven by this audit.

### P1

No unresolved P1 implementation item remains from the findings above. The
clean-install toolchain, Docker major-version alignment, and staged verification
command were fixed and verified. The remaining work is P2/P3.

### P2

1. Resolve or formally document the duplicate core versus standalone
   observability contracts.
2. Add cross-package lifecycle and DI conformance suites.
3. Expand routing tests across HTTP/2, mounted routers, encoded paths, and
   generated route documentation.
4. Add a public-boundary error-details redaction policy.
5. Add the cross-surface malformed-security-input matrix.
6. Add CI workflow coverage for the authoritative verification command.

### P3

1. Improve static dependency analysis so template strings and examples are not
   counted as runtime imports.
2. Normalize package-local script naming and add explicit typecheck scripts or
   document that `lint` is the typecheck command.
3. Review optional public packages for documentation consistency and examples.

## Audit conclusion

StreetJS already presents a coherent direction around the core facade, explicit
ownership, modular capabilities, and compatibility layers. The primary remaining
work is cross-package contract coverage and resolving the duplicate observability
ownership model. Package count is not the blocker; verification and
reproducibility now have a working baseline through `npm run verify`.
