<div align="center">

<img src="https://hassanmubiru.github.io/StreetJS/assets/images/logo.svg" alt="StreetJS" width="96" height="96" />

# StreetJS

### The integrated TypeScript backend framework — built on Node.js core, not on a pile of dependencies.

Auth, realtime, ORM, jobs, messaging, observability and a signed plugin ecosystem — included by default. **No Express. No `pg`. No Prisma.** Just 3 runtime dependencies.

[![npm version](https://img.shields.io/npm/v/streetjs?color=2563EB&label=streetjs)](https://www.npmjs.com/package/streetjs)
[![npm downloads](https://img.shields.io/npm/dm/streetjs?color=2563EB)](https://www.npmjs.com/package/streetjs)
[![License: MIT](https://img.shields.io/badge/license-MIT-64748B.svg)](LICENSE)
[![CI](https://github.com/hassanmubiru/StreetJS/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/hassanmubiru/StreetJS/actions/workflows/ci-cd.yml)
[![CodeQL](https://github.com/hassanmubiru/StreetJS/actions/workflows/codeql.yml/badge.svg)](https://github.com/hassanmubiru/StreetJS/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/hassanmubiru/StreetJS/badge)](https://securityscorecards.dev/viewer/?uri=github.com/hassanmubiru/StreetJS)
[![npm provenance](https://img.shields.io/badge/npm-provenance-2563EB?logo=npm)](https://www.npmjs.com/package/streetjs)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-3C873A)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-%3E%3D5.0-3178C6)](https://www.typescriptlang.org)
[![Discord](https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/Wgazap3yv)

[**Documentation**](https://hassanmubiru.github.io/StreetJS/) · [**Get Started**](https://hassanmubiru.github.io/StreetJS/getting-started/) · [**Compare**](https://hassanmubiru.github.io/StreetJS/compare/) · [**Plugins**](https://hassanmubiru.github.io/StreetJS/plugins/) · [**Discussions**](https://github.com/hassanmubiru/StreetJS/discussions) · [**Discord**](https://discord.gg/Wgazap3yv)

</div>

---

## What is StreetJS?

StreetJS is a TypeScript backend framework that ships the things real applications need — HTTP, dependency injection, a native database layer, auth, realtime, jobs, messaging and observability — as first-class, typed building blocks. It is built directly on Node.js core modules (`node:http`, `node:net`, `node:crypto`, `node:stream`, `node:cluster`) with only **three runtime dependencies** (`reflect-metadata`, `ws`, `zod`).

It targets five problems that slow teams down:

- **Dependency sprawl** — a typical Node backend pulls in Express + `pg` + an ORM + a validator + an auth library + a WebSocket lib, each with its own transitive tree. StreetJS replaces that stack with one typed framework and a tiny dependency surface.
- **Integration complexity** — auth, realtime, ORM and OpenAPI are designed to work together, sharing the same context and types, instead of being glued together by hand.
- **Supply-chain risk** — fewer dependencies plus signed plugins, npm provenance, SBOM generation, CodeQL and secret scanning mean a smaller, more auditable attack surface.
- **Cost of infrastructure** — dependency-light services with fast cold starts are cheaper to self-host; you own your data and your bill (see [StreetJS on a Budget](https://hassanmubiru.github.io/StreetJS/deployment/budget/)).
- **Time-to-production** — `street create` scaffolds a production-ready project (PostgreSQL, JWT, Docker, CI) in seconds.

> **Project status (honest):** the engineering is mature and CI-green; the gaps are community size and ecosystem breadth, not core capability. See the candid [Gap Analysis](https://hassanmubiru.github.io/StreetJS/STREETJS-GAP-ANALYSIS/).

---

## Why StreetJS?

A feature comparison against the most common Node.js choices. "Built in" means first-party and shipped with the framework; "plugin/3rd-party" means you assemble it yourself.

| Capability | StreetJS | Express | Fastify | NestJS |
|---|:--:|:--:|:--:|:--:|
| TypeScript-first | ✅ native | ⚠️ via `@types` | ✅ good | ✅ native |
| Dependency footprint | **3 runtime deps** | minimal core + many add-ons | lean core + plugins | larger (many `@nestjs/*`) |
| Routing + DI | ✅ built in | ❌ | ⚠️ via plugins | ✅ built in |
| Auth (JWT/sessions/RBAC/MFA) | ✅ built in | ❌ 3rd-party | ❌ 3rd-party | ⚠️ `@nestjs/passport` |
| Realtime (WebSocket + SSE) | ✅ built in | ❌ 3rd-party | ⚠️ plugin | ⚠️ `@nestjs/websockets` |
| ORM / DB | ✅ native PG/MySQL/SQLite + ORM | ❌ bring your own | ❌ bring your own | ⚠️ TypeORM/Prisma adapters |
| OpenAPI generation | ✅ built in | ❌ 3rd-party | ⚠️ plugin | ✅ `@nestjs/swagger` |
| Signed plugin system | ✅ Ed25519 + provenance | ❌ | ⚠️ plugins (unsigned) | ⚠️ modules (unsigned) |
| AI building blocks | ✅ `@streetjs/ai` + OpenAI plugin | ❌ | ❌ | ❌ |

*Comparison is feature-coverage, not performance. Benchmark your own workload — see [Performance](https://hassanmubiru.github.io/StreetJS/performance/) and the full honest writeups under [Compare](https://hassanmubiru.github.io/StreetJS/compare/).*

---

## Quick start

**Scaffold a project (recommended):**

```bash
npx @streetjs/cli create my-app
cd my-app
npm install
npm run dev
```

**Or add the framework to an existing project:**

```bash
npm install streetjs
```

**Minimal application:**

```typescript
import 'reflect-metadata';
import { streetApp, Controller, Get } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/api')
class HelloController {
  @Get('/hello')
  async hello(ctx: StreetContext) {
    ctx.json({ message: 'Hello from StreetJS!' });
  }
}

const app = streetApp({ port: 3000 });
app.registerController(HelloController);
await app.listen();
// [street] Listening on http://0.0.0.0:3000
```

> Requires Node.js ≥ 20, TypeScript ≥ 5.0, and `"type": "module"`. Full setup in [Getting Started](https://hassanmubiru.github.io/StreetJS/getting-started/).

---

## Features

| Area | What's included |
|---|---|
| **Core** | HTTP server, compiled-regex router, dependency injection, middleware, typed context, OpenAPI 3.1 generation, API versioning |
| **Data** | Native PostgreSQL wire driver (SCRAM-SHA-256), native MySQL, SQLite, connection pool, repositories, migrations, query builder, schema introspection, first-party [ORM](https://www.npmjs.com/package/@streetjs/orm) |
| **Security** | JWT, AES-256-GCM sessions, scrypt vault, RBAC, MFA (TOTP), WebAuthn/passkeys, mTLS, rate limiting, XSS sanitizer, CSRF, field-level encryption |
| **Realtime** | Bounded WebSocket server with channels & presence, Server-Sent Events |
| **Messaging** | Kafka, RabbitMQ, Redis, NATS transports; webhook dispatcher |
| **AI** | `@streetjs/ai` building blocks and the official OpenAI plugin |
| **Microservices** | HTTP/2, gRPC, circuit breaker, service registry, distributed lock, CQRS, saga, event bus |
| **Observability** | OpenTelemetry (OTLP), Prometheus `/metrics`, structured logging, health checks, P50/P99 telemetry |
| **DevOps** | `street` CLI (create/dev/build/generate/migrate/…), clustering, Docker scaffolding, GitHub Actions CI with provenance |
| **Ecosystem** | 19 official signed plugins, a plugin registry, and frontend SDKs (`@streetjs/{client,react,next,vue,nuxt}`) |

Full reference: [Documentation](https://hassanmubiru.github.io/StreetJS/).

---

## Official plugins

19 official, Ed25519-signed plugins published under the `@streetjs/` scope. Browse them on the [Official Plugins](https://hassanmubiru.github.io/StreetJS/plugins-official/) page.

| Category | Plugins |
|---|---|
| **Payments** | Stripe, PayPal |
| **Messaging / comms** | Twilio, SendGrid, Africa's Talking, Kafka, RabbitMQ, NATS |
| **Storage** | Amazon S3, Cloudflare R2 |
| **AI** | OpenAI |
| **Identity** | Auth0, Clerk, Supabase, Firebase |
| **Databases** | PostgreSQL, MySQL, MongoDB, Redis |

Build your own with the [Plugin Author Guide](https://hassanmubiru.github.io/StreetJS/ecosystem/plugin-author-guide/) and get it [certified](https://hassanmubiru.github.io/StreetJS/ecosystem/plugin-certification/).

---

## Security & supply chain

StreetJS treats supply-chain integrity as a first-class concern:

- **Ed25519 plugin signing** — official plugin manifests are signed; signatures are verified before load.
- **npm provenance** — packages are published from CI with provenance attestations.
- **SBOM** — a Software Bill of Materials is generated for releases.
- **CodeQL** — static analysis on every push (`codeql.yml`).
- **Secret scanning** — `secret-scan.yml` plus gitleaks configuration.
- **OpenSSF Scorecard** — continuous supply-chain scoring (`scorecard.yml`).
- **Runtime certification** — `npm run verify:runtime` produces a published [certification report](https://hassanmubiru.github.io/StreetJS/runtime-certification/).

Report vulnerabilities privately via the [Security Policy](SECURITY.md).

---

## Documentation

| Topic | Link |
|---|---|
| Getting Started | https://hassanmubiru.github.io/StreetJS/getting-started/ |
| Tutorials | https://hassanmubiru.github.io/StreetJS/tutorials/ |
| Examples | https://hassanmubiru.github.io/StreetJS/examples/ |
| Plugins | https://hassanmubiru.github.io/StreetJS/plugins/ |
| ORM | https://www.npmjs.com/package/@streetjs/orm |
| Security | https://hassanmubiru.github.io/StreetJS/security/ |
| Enterprise | https://hassanmubiru.github.io/StreetJS/enterprise/ |
| Compare | https://hassanmubiru.github.io/StreetJS/compare/ |
| Roadmap | https://hassanmubiru.github.io/StreetJS/roadmap/ |
| FAQ | https://hassanmubiru.github.io/StreetJS/faq/ |

---

## Community

- 🎧 [Discord](https://discord.gg/Wgazap3yv) — real-time help, technical discussion, and release news
- 💬 [Discussions](https://github.com/hassanmubiru/StreetJS/discussions) — questions, ideas, show-and-tell
- 🐛 [Issues](https://github.com/hassanmubiru/StreetJS/issues) — bugs and feature requests
- 🧭 [Contributing Guide](CONTRIBUTING.md) · [Contributor Path](https://hassanmubiru.github.io/StreetJS/community/contributor-path/) · [Code of Conduct](CODE_OF_CONDUCT.md)
- 🏛️ [Governance](GOVERNANCE.md) & RFC process
- 🗺️ [Roadmap](https://hassanmubiru.github.io/StreetJS/roadmap/) · [Adoption & Go-To-Market Roadmap](https://hassanmubiru.github.io/StreetJS/adoption/go-to-market-roadmap/)
- 🔬 [Runtime Certification](https://hassanmubiru.github.io/StreetJS/runtime-certification/) · [Gap Analysis](https://hassanmubiru.github.io/StreetJS/STREETJS-GAP-ANALYSIS/)

---

## Monorepo

This is an npm-workspaces monorepo of 47 packages. The headline packages:

| Package | npm | Description |
|---|---|---|
| `packages/core` | [`streetjs`](https://www.npmjs.com/package/streetjs) | The framework runtime |
| `packages/cli` | [`@streetjs/cli`](https://www.npmjs.com/package/@streetjs/cli) | Project scaffolding & dev tooling |
| `packages/orm` | [`@streetjs/orm`](https://www.npmjs.com/package/@streetjs/orm) | First-party ORM |
| `packages/plugin-*` | `@streetjs/plugin-*` | 19 official signed plugins |
| `packages/core-compat` | [`@streetjs/core`](https://www.npmjs.com/package/@streetjs/core) | **Deprecated** shim that re-exports `streetjs` |

```bash
npm run build          # build all packages
npm test               # core integration tests (requires PostgreSQL)
npm run verify:runtime # runtime certification battery
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development and test guide.

---

## License

[MIT](LICENSE) © street contributors
