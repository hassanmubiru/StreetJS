<!--
  StreetJS launch / backlink post.
  NOT published by Jekyll (the _marketing folder is not a collection).
  Copy-paste into Dev.to, Hashnode, Medium, or a GitHub Discussion.
  Each platform gives you a do-follow or referral backlink to the site, GitHub and npm.
  Replace links with a custom domain once configured.
-->

# StreetJS: a production-grade TypeScript backend framework with 2 dependencies

> **TL;DR** — StreetJS is a memory-safe TypeScript backend framework built straight on Node.js core. Native PostgreSQL wire driver, JWT, sessions, WebSockets, clustering, Kafka and RabbitMQ — no Express, no `pg`, no Prisma. Two runtime dependencies.
>
> `npm install streetjs` · [Docs](https://hassanmubiru.github.io/street/) · [GitHub](https://github.com/hassanmubiru/StreetJS) · [npm](https://www.npmjs.com/package/streetjs)

## Why another framework?

Most Node.js backends are an archaeology of dependencies: Express for HTTP, `pg` for Postgres, `jsonwebtoken` for auth, `multer` for uploads, `bcrypt` for hashing. Every one is a supply-chain surface and a memory-bounds question you didn't answer.

StreetJS takes the opposite bet: **implement the framework directly on Node.js core, with explicit memory ceilings on every component.** The result is a 2-dependency framework that still ships a full backend toolkit.

## What you get out of the box

- **Native PostgreSQL driver** — wire protocol v3 over `node:net`, SCRAM-SHA-256 auth, streaming rows with socket-level backpressure. No `pg`.
- **Security built in** — JWT, AES-256-GCM sessions, scrypt vault, sliding-window rate limiting, CSRF, CORS, CSP, WebAuthn and TOTP MFA.
- **Real-time** — bounded WebSocket server with heartbeat, typed events, and SSE.
- **Messaging** — built-in Kafka and RabbitMQ transports.
- **DI + OpenAPI** — an IoC container with constructor injection, and OpenAPI 3.1 generated from decorators.
- **Ops** — `node:cluster` coordinator, Prometheus metrics, OpenTelemetry tracing, health checks, and a PostgreSQL-backed job queue.

## 60-second start

```bash
npm install -g @streetjs/cli
street create my-api
cd my-api && npm install && street dev
# [street] Listening on http://0.0.0.0:3000 · OpenAPI at /openapi.json
```

```typescript
import { streetApp, Controller, Get } from 'streetjs';

@Controller('/hello')
class HelloController {
  @Get('/')
  greet(ctx) { ctx.json({ message: 'Hello from StreetJS!' }); }
}

const app = streetApp({ port: 3000 });
app.registerController(HelloController);
await app.listen();
```

## How it compares

In a `node:http` loopback benchmark (concurrency 50, 3 runs), StreetJS sustains **~27.5k req/s** — about **2.1× Express** and **2.3× NestJS** — while keeping its 2-dependency footprint. Full methodology and run-by-run numbers: [Performance report](https://hassanmubiru.github.io/street/performance/).

## Production-ready, honestly reported

StreetJS publishes a [certification summary](https://hassanmubiru.github.io/street/certification/): 10/10 automated gates (lint, build, 1,100+ tests, and security/observability/deployment/enterprise suites), with open follow-ups listed rather than hidden.

## Links

- 📖 Docs: https://hassanmubiru.github.io/street/
- 💻 GitHub: https://github.com/hassanmubiru/StreetJS
- 📦 npm: https://www.npmjs.com/package/streetjs

---

### Posting checklist (for backlinks — priority order)
1. **GitHub** — pin the repo, add topics: `typescript`, `nodejs`, `backend-framework`, `postgresql`, `kafka`, `rabbitmq`, `websockets`, `jwt`. (do-follow, highest authority)
2. **Dev.to** — publish this with a canonical_url pointing at the docs site; tags: `typescript`, `node`, `webdev`, `opensource`.
3. **Hashnode** — same content, set the original/canonical URL to the docs site.
4. **Reddit** — r/node, r/typescript (read each sub's self-promo rules first).
5. **Awesome lists** — PR to `awesome-nodejs`, `awesome-typescript` under "Frameworks".
6. **Hacker News** — "Show HN: StreetJS — a TypeScript backend framework with 2 dependencies".
7. **Product Hunt** — launch once the custom domain is live.
