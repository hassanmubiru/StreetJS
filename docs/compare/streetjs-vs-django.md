---
layout:    default
title:     "StreetJS vs Django"
parent:    "Compare"
nav_order: 5
permalink: /compare/streetjs-vs-django/
description: "StreetJS vs Django compared — a fully integrated Python framework vs a TypeScript-native backend with ORM, auth, admin, and realtime."
---

# StreetJS vs Django

**In one line:** Django is the integrated standard for Python web
development; StreetJS offers a comparable integrated feature set on a
TypeScript/Node stack.

As with Laravel, the primary decision is **language/runtime**: Python for Django,
TypeScript on Node.js for StreetJS.

---

## At a glance

| | StreetJS | Django |
|---|---|---|
| Language / runtime | TypeScript / Node.js | Python |
| ORM | `@streetjs/orm` (decorators, relations, migrations) | Django ORM (mature) |
| Migrations | SQL + model-driven (`Orm.makeMigration`) | `makemigrations` / `migrate` (excellent) |
| Auth / RBAC / MFA | Built in | Auth + permissions (MFA via packages) |
| Admin UI | `@streetjs/admin-ui` (RBAC, audit, users, tenancy) | Django Admin (famously strong) |
| Realtime | Built-in WebSockets + channels | Channels (separate package) |
| Ecosystem & community | Smaller / younger | Very large, mature |

---

## Where Django wins

- **Maturity & ecosystem:** decades of packages, a legendary admin, and a huge
  community.
- **Django Admin:** an auto-generated admin that is hard to beat for CRUD-heavy
  internal tools.
- **Data/ML adjacency:** Python's data and ML ecosystem is unmatched.

## Where StreetJS wins

- **One language across the stack** (TypeScript) with a shared typed client.
- **Node concurrency** for IO-bound and realtime-heavy services.
- **Realtime as a first-class, built-in** feature rather than an add-on.
- **Dependency-light, native database drivers.**

## Honest tradeoffs

Django is far more mature, with a larger ecosystem, a celebrated admin, and a huge
community. For Python teams or CRUD-heavy/admin-centric apps, Django is an
excellent default. StreetJS suits teams wanting Django-like breadth in a
TypeScript-first, realtime-friendly Node stack.

## FAQ

**Does StreetJS have a Django-Admin-like interface?**
[`@streetjs/admin-ui`](https://www.npmjs.com/package/@streetjs/admin-ui) provides
React components for user management, RBAC, audit logs, and multi-tenancy that
consume your existing APIs. It is component-based rather than fully auto-generated.

**How do migrations compare?**
StreetJS supports plain SQL migrations and model-driven generation via
`Orm.makeMigration`. Django's `makemigrations`/`migrate` workflow is more mature.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "Does StreetJS have a Django-Admin-like interface?", "acceptedAnswer": {"@type": "Answer", "text": "@streetjs/admin-ui provides React components for user management, RBAC, audit logs, and multi-tenancy that consume existing APIs. It is component-based rather than fully auto-generated like Django Admin."}},
    {"@type": "Question", "name": "How do StreetJS migrations compare to Django?", "acceptedAnswer": {"@type": "Answer", "text": "StreetJS supports plain SQL migrations and model-driven generation via Orm.makeMigration. Django's makemigrations/migrate workflow is more mature."}}
  ]
}
</script>
