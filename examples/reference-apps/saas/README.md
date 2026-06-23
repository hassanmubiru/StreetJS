# SaaS Platform — StreetJS reference application

A multi-tenant-style admin backend built on `@streetjs/admin`:

- `AdminService` — users, RBAC roles + wildcard permissions, `can()` authorization
- Append-only **audit log** of privileged actions
- HTTP health endpoints for orchestrators

This is a *reference app*: a runnable, tested starting point you adapt — not an
npm package. For a full scaffolded SaaS project (orgs, teams, invitations, API
keys, billing, dashboard), use `street create my-saas --starter saas`.

## Run

```bash
# from the repo root (resolves the local `streetjs` build)
npm run build -w packages/core
node examples/reference-apps/saas/server.mjs        # starts on :3000
```

HTTP endpoints:

- `GET /health/live`, `GET /health/ready` — liveness/readiness
- `GET /users` — list users
- `GET /audit` — recent audit-log events (most recent 50)

The exported `createSaas()` factory returns `{ admin, http, listen, close }`, so
you can drive `AdminService` (roles, `can()`, suspension) directly in code/tests.

## Verification (executed)

```bash
node examples/reference-apps/saas/smoke-test.mjs    # checks pass, exit non-zero on failure
```

Covered by CI in `.github/workflows/reference-apps.yml` and benchmarked via
`scripts/benchmark-reference-apps.mjs` (authorization `can()` throughput is
MEASURED, relative, in-memory single-instance).

## Security configuration

- Errors return a fixed `Bad Request` message; exception detail is logged
  server-side only (no stack leaks to clients).
- Wire real authentication (`streetjs` `JwtService`) + `requireRoles` in front of
  the privileged routes before exposing this publicly.
- In production set `ALLOWED_ORIGINS`, `JWT_SECRET` (≥32), `SESSION_KEY` (64 hex),
  `KEK`, and `PG_*` via your platform's secret store.

## Deployment

Reuses the repo's deployment artifacts (`deploy/`): build the container
(`Dockerfile`), deploy to Kubernetes (`deploy/helm/street`) or Cloud Run
(`deploy/cloud-run/service.yaml`). Probes hit `/health/live` and `/health/ready`.
Validate any deployment with `scripts/deploy/smoke-test.sh`.

## Scaling notes

`AdminService` state is process-local in this demo; back it with PostgreSQL
(repository pattern) for multi-instance deployments, and front it with the core
`RateLimiter` + security headers.
