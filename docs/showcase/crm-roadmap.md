---
layout:      default
title:       "Multi-tenant CRM — roadmap"
permalink:   /showcase/crm-roadmap/
nav_exclude: true
description:  "Planned multi-tenant CRM reference app for StreetJS — to be built on the verified SaaS, RBAC, and multi-tenant foundation. Roadmap, not a demo."
sitemap: false
---

# Multi-tenant CRM — roadmap

> **✅ NOW BUILT.** This started as a roadmap item and has since shipped as a real,
> CI-tested reference app. See **[Multi-tenant CRM](/StreetJS/showcase/crm/)** and
> its source at
> [`examples/reference-apps/crm`](https://github.com/hassanmubiru/StreetJS/tree/main/examples/reference-apps/crm).
> The original plan is kept below for history.

---

## Why it's a roadmap item, not a demo

StreetJS's principle is *no fabricated proof*. A CRM is a distinct domain that
doesn't exist in source yet, so it is roadmapped rather than mocked up.

## Planned design (built on the verified SaaS foundation)

It will reuse the same plumbing the [SaaS reference app](/StreetJS/showcase/saas/)
already proves — organizations, RBAC, multi-tenant scoping (`tenant.ts` /
`orgScopedRepo`), the ORM, and the audit log — and add a CRM domain on top:

```
Reuse SaaS plumbing (orgs/RBAC/multi-tenant + ORM relations + audit)
  └─ CRM domain: contacts ─▶ companies ─▶ deals ─▶ pipeline stages ─▶ activity timeline
```

## Definition of done (so it ships as real proof)

- `examples/reference-apps/crm` with `server.mjs` + `smoke-test.mjs`
- A `reference-apps.yml` CI matrix entry (smoke test green)
- An org-scoping property test (reusing the SaaS tenant-isolation pattern)
- A README + architecture diagram + screenshots + a deploy path
- A per-app showcase page with the Live · Source · Deploy · Docs quadrant

Tracked in [`SHOWCASE-ROADMAP.md`](https://github.com/hassanmubiru/StreetJS/blob/main/SHOWCASE-ROADMAP.md) (item 9).
