---
layout:    default
title:     "StreetJS vs Fastify"
parent:    "Compare"
nav_order: 2
permalink: /compare/streetjs-vs-fastify/
description: "StreetJS vs Fastify compared — both performance-focused Node frameworks. StreetJS adds DI, native PostgreSQL, ORM, auth, and realtime out of the box; Fastify favors a plugin ecosystem."
---

# StreetJS vs Fastify

**In one line:** Both are performance-minded Node frameworks; Fastify is a fast
router with a rich plugin system, while StreetJS bundles DI, database, auth, and
realtime as first-class, typed building blocks.

---

## At a glance

| | StreetJS | Fastify |
|---|---|---|
| Focus | Integrated backend platform | High-performance router + plugins |
| Routing | Decorator controllers | Schema-based route definitions |
| Dependency injection | Built-in | Via plugins/decorators |
| Database | Native PG driver, MySQL, SQLite, ORM | Bring your own (plugins) |
| Validation | `@Validate` | JSON Schema (built in, excellent) |
| Auth / RBAC / MFA | Built in | Plugins |
| WebSockets | Built in + channels | `@fastify/websocket` plugin |
| Dependencies | Dependency-light core | Lean core + chosen plugins |
| Ecosystem & community | Smaller / younger | Large, very active |

---

## Where Fastify wins

- **Schema-first validation & serialization** is a standout — fast JSON Schema
  validation and serialization are core strengths.
- **Mature plugin ecosystem** and a large, active community.
- **Proven at scale** across many production deployments.

## Where StreetJS wins

- **Batteries included:** DI, ORM, auth (JWT/sessions/RBAC/MFA), and realtime
  ship together — fewer plugins to choose, wire, and keep compatible.
- **TypeScript-native ergonomics:** decorator controllers and a typed context.
- **Full-stack:** a typed client SDK and framework hooks plus `street create
  --frontend` scaffolding.

## Honest tradeoffs

Fastify has a larger ecosystem and a longer track record, and its schema-based
validation/serialization is best-in-class. If you want to compose your own stack
around a fast core with proven plugins, Fastify is excellent. If you prefer an
integrated, typed platform with less assembly, StreetJS fits better.

---

## Migrating from Fastify

Fastify route handlers and hooks map to StreetJS controllers and middleware. See
the [Fastify → StreetJS migration guide](/migration-from-fastify/).

## FAQ

**Which is faster?**
Both target low overhead on Node core. Differences are workload-specific —
benchmark your own routes and payloads. See [Performance](/performance/).

**Does StreetJS have JSON Schema validation?**
StreetJS validates via `@Validate` schemas and generates OpenAPI. Fastify's
JSON-Schema-centric pipeline is more granular for serialization tuning.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "Is StreetJS or Fastify faster?", "acceptedAnswer": {"@type": "Answer", "text": "Both target low overhead on Node core HTTP. Differences are workload-specific; benchmark your own routes, payloads, and database."}},
    {"@type": "Question", "name": "Does StreetJS support JSON Schema validation like Fastify?", "acceptedAnswer": {"@type": "Answer", "text": "StreetJS validates via @Validate schemas and generates OpenAPI. Fastify's JSON-Schema-centric pipeline offers more granular serialization tuning."}}
  ]
}
</script>
