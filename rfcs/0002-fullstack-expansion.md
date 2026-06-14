---
rfc: 0002
title: Backend-first full-stack expansion (client SDK, framework adapters, UI kits)
status: Proposed
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

**Prerequisites (before frontend work):**
1. ORM model-driven migrations (this RFC's sibling work — in progress).
2. Publish `@streetjs/orm`.
3. Strengthen production docs; grow community; gather case studies.

**Then:**
4. `@streetjs/client` — typed API client, auth/session, realtime, uploads,
   search, AI streaming. Tree-shakeable; browser + Node; `fetch`/`WebSocket`
   based; zero framework deps.
5. `@streetjs/react` — hooks (`useAuth`, `useQuery`, `useMutation`, `useRealtime`,
   `useChannel`, `useSearch`, `useAIChat`) over `client`; SSR/RSC/Suspense-safe.
6. `@streetjs/next` — auth/session/realtime/edge helpers; no core changes.
7. `@streetjs/vue` + `@streetjs/nuxt` — composables over `client`.
8. UI kits (`auth-ui`, `ai-ui`, `admin-ui`) — accessible, themeable, dark-mode;
   consume existing APIs, never duplicate backend logic.
9. Starter kits via `street create` (SaaS/e-commerce/dating/social/AI/realtime)
   wiring backend + chosen frontend + Docker + CI.

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
