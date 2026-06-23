---
layout:      default
title:       "SaaS Platform — built with StreetJS"
permalink:   /showcase/saas/
nav_exclude: true
description:  "A multi-tenant SaaS backend built with StreetJS — auth, RBAC, organizations, audit log. Runnable reference app + one-command starter."
---

# SaaS Platform — built with StreetJS

**Auth · RBAC · Multi-tenant · Audit — the whole SaaS core in one app.**

- **Live demo:** _coming soon_ (see the [demo plan](https://github.com/hassanmubiru/StreetJS/blob/main/DEMO-INFRA-PLAN.md))
- **Source:** [`examples/reference-apps/saas`](https://github.com/hassanmubiru/StreetJS/tree/main/examples/reference-apps/saas)
- **Scaffold your own:** `street create my-saas --starter saas --with-admin-ui`
- **Deploy:** [`deploy/cloud-run/service.yaml`](https://github.com/hassanmubiru/StreetJS/tree/main/deploy) · **Docs:** [Starters](/StreetJS/starters/)

## Architecture

```
HTTP request
  ├─ authMiddleware (JWT)              core
  ├─ requireRoles(owner|admin|member) core (RBAC)
  ├─ apiKeyAuth (X-API-Key)           src/middleware/apiKeyAuth.ts
  └─ tenant scoping                   src/middleware/tenant.ts → orgScopedRepo(org_id)
        └─ modules: orgs · members · invitations · apikeys · settings · audit · notifications · dashboard(SSR)
              └─ PostgreSQL (organizations, memberships, invitations, api_keys, audit_logs, notifications, subscriptions)
```

Every org-scoped query/mutation flows through `orgScopedRepo(org_id)`, so a request
authenticated for one tenant can never read or write another's rows. This is
enforced by a property-based test (`saas-tenant-isolation.pbt`).

## Run it locally

```bash
npm run build -w packages/core
node examples/reference-apps/saas/server.mjs        # :3000
# GET /users · GET /audit · GET /health/ready
```

## How it's built

`@streetjs/admin` provides `AdminService` (users, wildcard RBAC, `can()`, audit
log). The scaffolded starter adds organizations, invitations, API keys, settings,
notifications, and an SSR dashboard — all on the core framework with no
third-party runtime deps by default; billing/email are opt-in (`--with-*`).

## Learning path

1. [REST API](/StreetJS/showcase/) — controllers, repositories, validation
2. JWT Authentication — sessions + protected routes
3. **SaaS** — organizations, RBAC, multi-tenancy, audit
4. Add billing — `--with-billing` (Stripe) or `--with-marzpay`

> This is a real, CI-tested reference app, not a mockup. Browse all demos in the
> [Showcase](/StreetJS/showcase/).
