---
layout:    default
title:     "StreetJS vs AdonisJS"
parent:    "Compare"
nav_order: 11
permalink: /compare/streetjs-vs-adonisjs/
description: "StreetJS vs AdonisJS compared — two integrated TypeScript backend frameworks. AdonisJS is a mature MVC framework with Lucid ORM and a large ecosystem; StreetJS is dependency-light with a native PostgreSQL driver and supply-chain integrity features."
---

# StreetJS vs AdonisJS

**In one line:** Both are integrated TypeScript backend frameworks. AdonisJS is a
mature, opinionated MVC framework with Lucid ORM, authentication, and a large
ecosystem; StreetJS is a dependency-light framework built on Node.js core with a
native PostgreSQL driver, built-in realtime, and supply-chain integrity features.

---

## At a glance

| | StreetJS | AdonisJS |
|---|---|---|
| Focus | Dependency-light, integrated backend | Full-featured MVC framework |
| Routing | Decorator controllers | Controllers + route files |
| Dependency injection | Built in | Built-in IoC container |
| ORM / database | Native PG driver, MySQL, SQLite | Lucid ORM (Knex-based) |
| Validation | `@Validate` schemas + OpenAPI | VineJS (built in) |
| Auth / RBAC | Built in | `@adonisjs/auth` (built in) |
| WebSockets / realtime | Built in + channels | Transmit / bring your own |
| CLI & scaffolding | `street create` + generators | Ace CLI + generators |
| Runtime dependencies | Dependency-light core | Larger dependency tree |
| Supply chain | Provenance, SBOM, signed plugins | Standard npm packaging |
| Ecosystem & maturity | Smaller / younger | Mature, large, well-documented |

---

## Where AdonisJS wins

- **Maturity and ecosystem.** A long track record, extensive first-party
  packages (Lucid, Auth, Mailer, Drive, Transmit), and thorough documentation.
- **Lucid ORM.** A full-featured Active Record ORM with migrations, relations,
  and a large feature surface built on Knex.
- **Community and learning resources.** A larger community and more tutorials,
  courses, and third-party content.

## Where StreetJS wins

- **Dependency-light architecture.** Built on Node.js core modules with a small
  runtime footprint, rather than a broad dependency tree.
- **Native PostgreSQL driver.** Implements the wire protocol directly (no `pg`),
  with streaming and bounded memory; MySQL and SQLite are also supported.
- **Built-in realtime.** WebSocket channels and SSE ship as first-class features.
- **Supply-chain integrity.** npm provenance, a published SBOM, and Ed25519
  plugin signing are part of the release process.
- **Typed full-stack.** A typed client SDK plus `street create --frontend`
  scaffolding for React and Next.js.

## Honest tradeoffs

AdonisJS is the more mature choice with a larger ecosystem, a feature-rich ORM,
and more learning resources — if you want a well-trodden MVC framework with
strong conventions, it is an excellent fit. StreetJS is younger and its community
is smaller; choose it when a dependency-light core, a native database driver, and
supply-chain integrity features matter to your project. Evaluate ORM needs
specifically: Lucid is broader today than the StreetJS repository layer.

---

## FAQ

**Is StreetJS an MVC framework like AdonisJS?**
StreetJS uses decorator controllers, services, and repositories rather than a
prescribed MVC layout with view templating. AdonisJS is a more traditional MVC
framework and includes the Edge template engine.

**Does StreetJS have an ORM comparable to Lucid?**
StreetJS provides a typed repository layer and migrations over its native
drivers. Lucid is a more feature-complete ORM today; compare against your data
modeling requirements.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "Is StreetJS an MVC framework like AdonisJS?", "acceptedAnswer": {"@type": "Answer", "text": "StreetJS uses decorator controllers, services, and repositories rather than a prescribed MVC layout with view templating. AdonisJS is a more traditional MVC framework and includes the Edge template engine."}},
    {"@type": "Question", "name": "Does StreetJS have an ORM comparable to Lucid?", "acceptedAnswer": {"@type": "Answer", "text": "StreetJS provides a typed repository layer and migrations over its native drivers. AdonisJS's Lucid is a more feature-complete ORM today; compare against your data modeling requirements."}}
  ]
}
</script>
