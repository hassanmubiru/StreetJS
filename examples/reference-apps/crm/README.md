# Multi-tenant CRM — StreetJS reference application

A CRM backend built on the same foundation as the [SaaS app](../saas/): strict
**per-organization (tenant) data scoping** + `@streetjs/admin` **RBAC**. Domain:
companies → contacts → deals → pipeline stages → an activity timeline.

- **Multi-tenancy** — every read and write is constrained to the caller's
  `org_id`; one tenant can never see or mutate another's data (proved by the smoke
  test, including a rejected cross-tenant deal move).
- **RBAC** — writes require `crm:write`, reads require `crm:read`, enforced via
  `AdminService.can()` (roles `crm-editor` / `crm-viewer`).
- **Pipeline** — deals move through `lead → qualified → proposal → won/lost`; every
  transition is recorded in the activity timeline.

This is a *reference app*: a runnable, tested starting point you adapt — not an
npm package.

## Run

```bash
# from the repo root (resolves the local workspace packages)
npm run build -w packages/core
npm run build -w packages/admin
node examples/reference-apps/crm/server.mjs        # starts on :3000
```

HTTP surface (tenant via `X-Org-Id`, actor via `X-User-Id` for RBAC):

| Method | Path | Notes |
|---|---|---|
| GET | `/health/live`, `/health/ready` | liveness/readiness |
| POST | `/companies` | `{ name }` (needs `crm:write`) |
| POST | `/contacts` | `{ name, email?, companyId? }` |
| POST | `/deals` | `{ title, contactId?, amountCents? }` → stage `lead` |
| POST | `/deals/:id/move` | `{ stage }` — one of `lead/qualified/proposal/won/lost` |
| GET | `/contacts`, `/deals` | org-scoped lists |
| GET | `/pipeline` | deals grouped by stage (count + total value) |

Example:

```bash
curl -X POST localhost:3000/companies -H 'x-org-id: acme' -d '{"name":"Acme Inc"}'
curl -X POST localhost:3000/deals     -H 'x-org-id: acme' -d '{"title":"Enterprise plan","amountCents":500000}'
curl localhost:3000/pipeline          -H 'x-org-id: acme'
```

## How it's built

`CrmStore` keeps each org's companies/contacts/deals/activities in an isolated
bucket keyed by `org_id`, so cross-tenant access is impossible *by construction*
(not by a filter you can forget). `@streetjs/admin`'s `AdminService` provides the
RBAC roles and `can()` authorization. For production, back `CrmStore` with
PostgreSQL using the repository pattern (an `org_id` column + a tenant-scoped repo,
exactly as the scaffolded SaaS starter does in `src/middleware/tenant.ts`).

## Verification (executed)

```bash
node examples/reference-apps/crm/smoke-test.mjs    # 16/16 checks, exit 0
```

Smoke proves: tenant isolation (each org sees only its own deals; a cross-tenant
move is a scoped 404), pipeline transitions, the activity timeline, invalid-stage
rejection, and RBAC (a `crm-viewer` is denied writes 403 but allowed reads; a
`crm-editor` may write).

## Security configuration

- The demo resolves tenant/actor from headers for simplicity. In production,
  derive `org_id` from the authenticated session/JWT and the actor from
  `authMiddleware`, never from client-supplied headers.
- Add `securityHeaders`, `RateLimiter`, and input validation; store deals/contacts
  in PostgreSQL with the `org_id` scoping enforced in the repository layer.
- In production set `ALLOWED_ORIGINS`, `JWT_SECRET`, `SESSION_KEY`, `KEK`, `PG_*`.

## Deployment

Reuses the repo's deployment artifacts (`deploy/`): Docker, Kubernetes
(`deploy/helm/street`), or Cloud Run (`deploy/cloud-run/service.yaml`). Probes hit
`/health/live` and `/health/ready`; validate with `scripts/deploy/smoke-test.sh`.
