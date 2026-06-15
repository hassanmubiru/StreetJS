---
layout:    default
title:     "StreetJS vs Express"
parent:    "Compare"
nav_order: 1
permalink: /compare/streetjs-vs-express/
description: "StreetJS vs Express.js compared — TypeScript-first DI, native PostgreSQL driver, built-in auth/WebSockets vs Express's minimal middleware router. Honest tradeoffs and a migration path."
---

# StreetJS vs Express

**In one line:** Express is a minimal, unopinionated HTTP router you assemble from
many third-party packages; StreetJS is a typed, batteries-included backend
framework with DI, database, auth, and realtime built in.

---

## At a glance

| | StreetJS | Express |
|---|---|---|
| Language | TypeScript-first | JavaScript (types via `@types/express`) |
| Routing | Decorator controllers (`@Controller`, `@Get`) | Imperative `app.get(...)` |
| Dependency injection | Built-in IoC container | None (bring your own) |
| Database | Native PostgreSQL driver, MySQL, SQLite, ORM | None (add `pg`/Prisma/etc.) |
| Auth | JWT, sessions, RBAC, MFA built in | Add `passport`, `jsonwebtoken`, … |
| WebSockets | Built-in server + channels | Add `ws`/`socket.io` |
| Validation / OpenAPI | `@Validate`, auto OpenAPI | Add `joi`/`zod` + `swagger-*` |
| Dependencies | Very few (core is dependency-light) | Small core, but apps pull many |
| Ecosystem & community | **Smaller / younger** | **Huge, battle-tested** |

---

## Where Express wins

- **Ecosystem & longevity.** Express has a decade-plus of middleware, Stack
  Overflow answers, and hiring pool. If you need an obscure integration, it
  probably already exists.
- **Minimalism.** If you want just a router and will hand-pick every other
  library, Express stays out of your way.
- **Maturity.** It is one of the most deployed Node frameworks in the world.

## Where StreetJS wins

- **Cohesion.** Routing, DI, database, auth, validation, OpenAPI, and WebSockets
  ship together and are designed to work as one — far less glue code.
- **TypeScript-native.** Decorators and typed context instead of `any`-heavy
  middleware chains.
- **Dependency surface.** Fewer transitive dependencies to audit and patch.
- **Frontend story.** `@streetjs/client` + `@streetjs/react/vue/next/nuxt` give a
  typed SDK and hooks; `street create --frontend` scaffolds both tiers.

## Honest tradeoffs

StreetJS is younger. Its community, third-party plugins, and tutorial volume are
smaller than Express's, and you will find fewer external blog posts. If your team
optimizes for the largest possible ecosystem and hiring pool today, Express (or
NestJS) is the safer bet. If you value an integrated, typed, low-dependency stack,
StreetJS is compelling.

---

## Migrating from Express

The route-handler mental model maps cleanly: an Express `(req, res)` handler
becomes a controller method taking `StreetContext`. See the step-by-step
[Express → StreetJS migration guide](/migration-from-express/).

```typescript
// Express
app.get('/users/:id', async (req, res) => {
  const user = await db.users.findById(req.params.id);
  res.json(user);
});

// StreetJS
@Controller('/users')
class UsersController {
  @Get('/:id')
  async get(ctx: StreetContext) {
    ctx.json(await this.users.findById(ctx.params['id']!));
  }
}
```

---

## FAQ

**Is StreetJS faster than Express?**
It depends entirely on your workload. StreetJS builds on Node core HTTP and a
native PostgreSQL driver, which avoids some layers, but real numbers depend on
your routes and database. Measure your own app — see [Performance](/performance/).

**Can I reuse Express middleware?**
Not directly — StreetJS uses its own `(ctx, next)` middleware signature. Most
common needs (CORS, security headers, rate limiting, body parsing) are built in.

**Does StreetJS lock me in?**
Controllers and services are plain classes; business logic stays portable. The
migration guide shows the reverse mapping too.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "Is StreetJS faster than Express?", "acceptedAnswer": {"@type": "Answer", "text": "It depends on the workload. StreetJS builds on Node core HTTP and a native PostgreSQL driver, but real performance depends on your routes and database. Measure your own application."}},
    {"@type": "Question", "name": "Can I reuse Express middleware in StreetJS?", "acceptedAnswer": {"@type": "Answer", "text": "Not directly. StreetJS uses its own (ctx, next) middleware signature, but common needs like CORS, security headers, rate limiting, and body parsing are built in."}},
    {"@type": "Question", "name": "Does StreetJS lock me in?", "acceptedAnswer": {"@type": "Answer", "text": "Controllers and services are plain classes, so business logic stays portable, and a migration guide documents the mapping in both directions."}}
  ]
}
</script>
