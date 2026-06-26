# StreetJS Docker Review (Phase 4)

> Read-only audit of every tracked Dockerfile. Evidence: `git ls-files | grep Dockerfile`.

## Inventory & classification (VERIFIED)

| Dockerfile | Class | Disposition | Notes |
|---|---|---|---|
| `infra/docker/Dockerfile` | **Production** | KEEP (moved here this sprint) | Framework app image: multi-stage, distroless runtime (`gcr.io/distroless/nodejs20`, digest-pinned), non-root. Build context = repo root via callers' `-f infra/docker/Dockerfile .`. |
| `packages/registry-server/Dockerfile` | **Production (service)** | KEEP in package | `@streetjs/registry-server` is a deployable service; `docker build packages/registry-server` is its documented context, exercised by `scripts/registry/e2e.mjs`. Standard monorepo per-service Dockerfile (cf. Kubernetes per-component images). |
| `app-react/Dockerfile` | Example (scaffold sample) | KEEP within sample; relocate the whole `app-*` dir to `examples/scaffold-*` (see cleanup plan) | A generated `street create` sample app; shipping a Dockerfile with it is correct. Base image **digest-pinned** this sprint. |
| `app-next/Dockerfile` | Example (scaffold sample) | same | digest-pinned |
| `app-htmx/Dockerfile` | Example (scaffold sample) | same | digest-pinned |
| `app-none/Dockerfile` | Example (scaffold sample) | same | digest-pinned |
| `demos/Dockerfile` | Example (demo) | KEEP in `demos/` | Demo app image; appropriate alongside the demo. |

## Phase-4 determinations
- **Which are production:** `infra/docker/Dockerfile` (framework) and `packages/registry-server/Dockerfile` (service).
- **Which are examples:** the four `app-*/Dockerfile` (scaffold samples) and `demos/Dockerfile`.
- **Plugins must not expose unnecessary Dockerfiles:** **VERIFIED — no `packages/plugin-*` ships a Dockerfile** (`find packages/plugin-*` → none). No action needed.
- **Belong in `infra/docker/`:** the framework Dockerfile (already moved there this sprint).
- **Should not ship publicly:** none — all Dockerfiles are either production service images or example/demo apps with no secrets (verified: no credentials in any Dockerfile; secrets are injected via env/`valueFrom` ARNs with placeholder `REGION`/`ACCOUNT`).

## Hardening status
- ✅ All base images digest-pinned (`node:20-alpine@sha256:…`) — Scorecard Pinned-Dependencies satisfied; Dependabot `docker` ecosystem tracks the digests at `infra/docker`, `app-*`, `demos`, `packages/registry-server`.
- ✅ Compose files consolidated under `infra/docker/compose/` with repo-root-relative paths, validated via `docker compose config`.
- ◑ Recommendation: relocate `app-*` scaffold samples under `examples/` (organization only — see `plans/REPOSITORY-CLEANUP-PLAN.md`).
