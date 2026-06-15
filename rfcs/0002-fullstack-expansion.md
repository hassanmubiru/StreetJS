---
rfc: 0002
title: Backend-first full-stack expansion (client SDK, framework adapters, UI kits)
status: Accepted
authors: ["@hassanmubiru"]
created: 2026-06-14
tracking-issue:
---

# RFC 0002 — Backend-first full-stack expansion

## Summary

Expand StreetJS into a full-stack platform **additively**: a universal client
SDK, framework adapters (React/Next/Vue/Nuxt), and UI kits — each an independent
package that consumes published APIs, **never** core internals. StreetJS Core
stays backend-first, dependency-light, and unchanged.

## Motivation

Adoption is gated partly by "what does my frontend do?" Today StreetJS is
backend-only. A type-safe client + thin framework adapters lower the barrier to a
full app without compromising the backend identity or adding frontend weight to
core.

## Hard constraints (non-negotiable)

- **No frontend dependency may enter `streetjs` core** (no React/Vue/Next/Nuxt).
- **No rewrite** of routing, DI, database, security, plugins, realtime, or
  observability. Purely additive.
- Every new piece is a **separate package** under `packages/`.
- Frontend adapters consume **`@streetjs/client`** (or public HTTP/WS APIs), never
  core internals.
- **Zero regressions** — all existing tests stay green; new packages have their own.

## Package boundaries

```
packages/
  core        (unchanged, backend-first)
  cli, orm    (existing)
  client      (NEW — universal, framework-agnostic SDK)
  react, next, vue, nuxt   (NEW — thin adapters over client)
  auth-ui, ai-ui, admin-ui (NEW — UI kits over client)
  starter-kits (NEW — scaffolds)
```

Dependency rule (enforced by review + package.json): `core` depends on nothing
frontend; adapters depend on `client`; UI kits depend on `client` (+ their
framework as a peer dep). `client` has zero framework assumptions.

## Phased plan (priority order)

**Status:** prerequisites done — ORM relations + **model-driven migrations**
shipped and `@streetjs/orm` **published with provenance**. **All implementation
phases are now complete in-repo (0.1.0 preview), each build + test green:**

| Phase | Package | Status | Verification |
| ----- | ------- | ------ | ------------ |
| 1 | `@streetjs/client` | ✅ Done | 12 unit tests; `client-ci.yml` (Node 20/22) |
| 2 | `@streetjs/react` | ✅ Done | build + 2 export-shape tests |
| 3 | `@streetjs/next` | ✅ Done | build + 4 tests |
| 4 | `@streetjs/vue` | ✅ Done | build + 1 export-shape test |
| 4 | `@streetjs/nuxt` | ✅ Done | build + 3 tests (plugin factory + re-exports) |
| 5 | `@streetjs/admin-ui` | ✅ Done | build + 4 tests (RBAC, audit, users, tenancy) |
| 6 | `@streetjs/auth-ui` | ✅ Done | build + 4 tests (login/register/forgot/MFA/profile) |
| 7 | `@streetjs/ai-ui` | ✅ Done | build + 5 tests (chat/streaming/RAG/tool viewer) |
| 8 | `street create --frontend` | ✅ Done | build + 4 scaffolding tests (react/next + CI) |

All eight integration/UI packages plus the client are exercised by
`.github/workflows/frontend-ci.yml` (build + `tsc --noEmit` + export-shape tests
on Node 20 & 22).

**Honest verification note:** UI/framework packages are verified via TypeScript
build (`tsc`), `tsc --noEmit` type-checks, and **export-shape + pure-function
tests** (e.g. `ErrorText`/`AsyncState`/`StreamingMessage` rendered as elements and
asserted on props). They are **not** verified with full DOM render tests
(jsdom/testing-library), which would add dev dependencies the project avoids. This
is a deliberate, stated tradeoff — not a silent skip.

**Prerequisites (before frontend work):**
1. ORM model-driven migrations — ✅ shipped.
2. Publish `@streetjs/orm` — ✅ published with provenance.
3. Strengthen production docs; grow community; gather case studies — ongoing.

**Delivered:**
4. `@streetjs/client` — typed API client, auth/session, realtime, uploads,
   search, AI streaming. Tree-shakeable; browser + Node; `fetch`/`WebSocket`
   based; zero framework deps.
5. `@streetjs/react` — hooks (`useAuth`, `useQuery`, `useMutation`, `useRealtime`,
   `useChannel`, `useSearch`, `useAIChat`) over `client`; SSR-safe.
6. `@streetjs/next` — server/edge clients + auth/session/cookie helpers.
7. `@streetjs/vue` + `@streetjs/nuxt` — composables over `client` + a Nuxt
   plugin factory (no hard `@nuxt/kit` dependency).
8. UI kits (`auth-ui`, `ai-ui`, `admin-ui`) — accessible, themeable, dark-mode
   (CSS-variable driven, no CSS-in-JS runtime); consume existing APIs, never
   duplicate backend logic.
9. Starter kits via `street create --frontend <react|next>` wiring backend +
   chosen frontend (`web/`) + Docker (already scaffolded) + a `ci.yml` workflow.

### Install note (monorepo)

A root `.npmrc` sets `legacy-peer-deps=true`. The framework adapters declare
React/Vue/Next as **peer** dependencies; without this, a fresh monorepo install
tries to auto-install mutually-incompatible peers (e.g. `next@16` → `react-dom@19`
vs the `react@18` devDep). The setting only affects dev-time install resolution
and has no effect on published package contents.

## Backward compatibility

Entirely additive. Core's public API and behavior are unchanged; no existing
package is modified except `cli` (additive `create` templates) and docs.

## Security considerations

- `@streetjs/client` must not weaken auth: tokens handled per platform guidance
  (httpOnly cookies server-side where possible), CSRF-aware, no secret leakage to
  the bundle.
- UI kits must not embed secrets; they call authenticated APIs only.
- Adapters inherit the backend's RBAC/audit — they cannot bypass it.

## Testing & verification

- `client`: unit tests with a mock fetch/WS; type-level tests for the typed API.
- Adapters: render/hook tests against a mocked `client`.
- A per-package CI job; the existing core suites remain the regression guard
  (zero-regression gate).

## Alternatives considered

- **Build a frontend framework:** rejected — out of scope and dilutes the
  backend-first identity.
- **Put adapters in core:** rejected — violates the dependency philosophy.

## Unresolved questions

- Codegen of the typed client from OpenAPI (StreetJS already generates OpenAPI) vs
  hand-written generics.
- How much SSR/session glue belongs in `next`/`nuxt` vs `client`.
