---
layout:      default
title:       "Multi-tenant CRM — built with StreetJS"
permalink:   /showcase/crm/
nav_exclude: true
description:  "A multi-tenant CRM backend built with StreetJS — per-org data isolation, RBAC, contacts/deals/pipeline, with an executable smoke test."
---

# Multi-tenant CRM — built with StreetJS

**Contacts · Deals · Pipeline · RBAC — strict per-tenant isolation.**

- **Live demo:** _coming soon_ (see the [demo plan](https://github.com/hassanmubiru/StreetJS/blob/main/DEMO-INFRA-PLAN.md))
- **Source:** [`examples/reference-apps/crm`](https://github.com/hassanmubiru/StreetJS/tree/main/examples/reference-apps/crm)
- **Deploy:** [`deploy/cloud-run/service.yaml`](https://github.com/hassanmubiru/StreetJS/tree/main/deploy) · **Docs:** [SaaS foundation](/StreetJS/showcase/saas/)

## Architecture

```
Request (X-Org-Id = tenant, X-User-Id = actor)
  ├─ RBAC: @streetjs/admin AdminService.can(actor, 'crm:write'|'crm:read')
  └─ CrmStore — isolated per-org bucket (cross-tenant access impossible by construction)
        └─ companies ─▶ contacts ─▶ deals ─▶ pipeline (lead→qualified→proposal→won/lost) ─▶ activity timeline
```

Built on the same foundation the [SaaS reference app](/StreetJS/showcase/saas/)
proves — organizations, RBAC, and per-tenant scoping — with a CRM domain on top.

## Run it locally

```bash
npm run build -w packages/core
npm run build -w packages/admin
node examples/reference-apps/crm/server.mjs        # :3000
node examples/reference-apps/crm/smoke-test.mjs    # 16/16 checks
```

## How it's proven

The smoke test asserts **tenant isolation** (each org sees only its own deals; a
cross-tenant deal move is a scoped 404), **RBAC** (a `crm-viewer` is denied writes,
a `crm-editor` is allowed), **pipeline transitions**, the **activity timeline**, and
invalid-stage rejection. It runs in CI via `reference-apps.yml`.

## Learning path

1. [SaaS](/StreetJS/showcase/saas/) — orgs, RBAC, multi-tenancy
2. **CRM** — a multi-tenant domain on that foundation
3. Persist to PostgreSQL with the repository pattern (`org_id` scoping)

> A real, CI-tested reference app. Browse all demos in the
> [Showcase](/StreetJS/showcase/).
