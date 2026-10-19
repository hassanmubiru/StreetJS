# StreetJS Dependency-Boundary Report

**Audit date:** 2026-10-20  
**Repository:** StreetJS  
**Scope:** `packages/*`, excluding generated `dist` and `dist-test` artifacts

## Method

The audit inspected all 99 workspace package manifests and scanned TypeScript
and JavaScript source-like files for static imports of `streetjs` and
`@streetjs/*`. The machine-readable source of package-level evidence is
[`package-inventory.json`](./package-inventory.json). Import counts include
tests and examples and are therefore not equivalent to production dependency
edges; each entry records its source/test split and file list.

Observed scan totals:

| Signal | Count |
|---|---:|
| Workspace packages | 99 |
| Static imports from the `streetjs` facade | 321 |
| Static imports from `@streetjs/*` packages | 236 |
| Packages with facade imports | 45 |
| Packages with no source test files | 1 (`streetjs` core facade) |
| Packages with no build script | 1 (`streetjs` core facade; it uses the root/core build path) |
| Packages with no package-local lint script | 3 (`@streetjs/cli`, `streetjs`, `@streetjs/edge`) |

## Intended dependency direction

The repository has four useful internal tiers:

1. **Core/foundation:** `streetjs`, container, context, exceptions, store,
   security, router, rate limiting, diagnostics, configuration, and testing.
2. **Data/runtime capabilities:** database, PostgreSQL, pool, repository,
   migrations, cache, websocket, realtime, queue, events, storage, workflow,
   gateway, observability, and related runtime packages.
3. **Optional integrations:** `plugin-*` packages and external-service
   connectors.
4. **Application/tooling adapters:** CLI, client, UI adapters, social/dating,
   AI, commerce, and developer tooling.

This is a conceptual layering, not a package-count reduction proposal. The
packages remain independently publishable and testable.

## Import classifications

### A — Legitimate application-facing facade usage

Evidence:

- CLI command implementations use `streetjs` in generated application snippets
  and for the public framework command/decorator surface.
- Integration examples and scaffold templates intentionally teach application
  developers to import from `streetjs`.
- The core package itself is the facade implementation and is expected to
  re-export stable public contracts.
- Product-capability packages such as dating and social packages consume core
  public services at their application boundary.

Decision: keep these imports. They are part of the one-framework developer
experience, not evidence of an internal dependency violation.

### B — Compatibility requirement

Evidence:

- `@streetjs/core-compat` explicitly imports `@streetjs/core`.
- Plugin packages import plugin lifecycle contracts from the facade or its
  compatibility surface.
- Backward-compatibility tests in queue and realtime pin the existing facade
  signatures.

Decision: retain until a separately versioned plugin SDK or compatibility
package is proven to preserve the same contracts. No mechanical replacement is
justified.

### C — Missing narrow contract

Confirmed improvements already completed:

- `Clock` and `systemClock` now come from `@streetjs/store` in workflow,
  events, storage, and gateway code.
- Queue store/window contracts now come from `@streetjs/store` and
  `@streetjs/ratelimit`.
- Realtime rate-limit store/window contracts now use the same owners.

Potential future C findings require contract-by-contract review. The most
important candidate is the observability surface, but it is not currently safe
to replace mechanically because the repository contains two distinct families:

- core's `HealthCheckRegistry` and `MetricsRegistry`, re-exported by
  `streetjs`; and
- standalone `@streetjs/health` (`HealthRegistry`) and `@streetjs/metrics`
  (`MetricsRegistry`) packages.

These are not proven to be the same runtime contracts. Treating them as
interchangeable would be an architectural change, not an import cleanup.

### D — Incorrect dependency direction

No production import was proven to be an unambiguous D finding by this audit.
Several apparent edges were generated code, template strings, examples, or
tests rather than runtime imports. They must not be promoted to dependency
violations without AST-level or source-context confirmation.

The CLI's feature catalog references optional packages as strings for install
plans and generated snippets. Those packages are not runtime dependencies of
the CLI and should not be added merely to satisfy a textual scan.

### E — Unclear; architectural investigation required

The following areas remain E until ownership is resolved:

- Core observability registries versus standalone health/metrics packages.
- Plugin SDK ownership: currently implemented in the core facade, while many
  optional plugins consume it.
- CLI command/decorator ownership, because the CLI generates code that targets
  both `streetjs` and optional package surfaces.
- Edge adapter references embedded in generated deployment templates.

No category E import was changed in this audit.

## Verified narrow owners

| Contract | Current owner | Evidence |
|---|---|---|
| `Clock`, `systemClock` | `@streetjs/store` | Public exports and passing workflow/storage/gateway builds/tests |
| `RateLimitStore`, in-memory implementation | `@streetjs/store` | Queue/realtime narrow imports and tests |
| `parseWindow` | `@streetjs/ratelimit` | Queue/realtime imports and rate-limit tests |
| Router implementation | `@streetjs/router` | Core router is a re-export wrapper |
| Error envelope | `@streetjs/exceptions` | Router and core use `toStreetErrorEnvelope` |
| JWT implementation | `@streetjs/security` | Core re-exports the standalone implementation |
| Container implementation | `@streetjs/container` plus legacy facade | Application-scoped and legacy tests |

## Dependency findings

### Resolved P1 — clean-install build was not reproducible

Before the audit fix, the root lockfile installed TypeScript `7.0.2`, while CLI
tests used the older compiler API through `import ts from 'typescript'` and
referenced `ModuleKind`, `ScriptTarget`, and `transpileModule`. The clean build
reported those members as missing.

The CLI development dependency is now pinned to `^5.9.3`, the lockfile was
regenerated, and a fresh `npm ci && npm run build` passes.

### Resolved P2 — facade and standalone observability contracts are distinct by decision

`streetjs` exports core `HealthCheckRegistry` and `MetricsRegistry`, while
`@streetjs/health` and `@streetjs/metrics` export separate public packages with
similar names but different APIs. The ownership decision is now explicit: core
owns framework-integrated contracts; standalone packages own framework-agnostic
contracts.

See [`observability-contracts.md`](./observability-contracts.md) and ADR 0019.
Do not merge or replace these contracts without a new ADR and compatibility
tests.

### Resolved P2 — package-local verification was inconsistent

Most packages have `build`, `test`, and `lint` scripts. The root now exposes
`npm run verify`, which separates build, lint, typecheck, offline, integration,
and external-service stages. The package inventory records the exact script
surface.

### P3 — static import scanning needs source-context awareness

Template strings, examples, generated scaffolds, and tests contain import-like
text. A raw regular-expression count overstates production dependency edges.
Future automated boundary checks should parse imports or otherwise exclude
template content before enforcing policy.
