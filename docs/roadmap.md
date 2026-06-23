---
layout:    default
title:     "Roadmap"
nav_order: 15
permalink: /roadmap/
description: "StreetJS Framework roadmap — what has shipped in the 1.0.x line, and what is being explored next."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Project</span>
<h1>Roadmap</h1>
<p>What has shipped, and what is being explored next for StreetJS.</p>
</div>

This page tracks the direction of StreetJS. Priorities shift based on community
feedback — open an issue or discussion to influence it.

> **Current release: v1.0.9.** Much of what earlier drafts of this roadmap listed
> as "future" has already landed in the 1.0.x line. The list below reflects what
> is actually in the codebase today. Items are verified against the published
> `streetjs` package, the `@streetjs/*` packages, and the docs.

---

## Shipped — available now

### Core runtime
- [x] HTTP server on `node:http`; compiled-regex router with parameter extraction
- [x] IoC container with constructor injection and circular-dependency detection
- [x] Middleware pipeline, typed context, `@Validate` schemas
- [x] OpenAPI 3.1 generation from decorators (served at `/openapi.json`)
- [x] **API versioning** — `@ApiVersion` / `@Deprecated` with `Deprecation`/`Sunset` headers
- [x] Clustering (`node:cluster`, IPC heartbeat, auto-restart), telemetry (ring buffer, P50/P99)
- [x] LRU cache, webhook dispatcher (HMAC + exponential backoff), streaming multipart upload

### Database
- [x] Native **PostgreSQL** wire driver (protocol v3, SCRAM-SHA-256 / MD5 / cleartext)
- [x] Native **MySQL / MariaDB** driver
- [x] **SQLite** support
- [x] Connection pool with bounded acquire queue; repository pattern (parameterized queries)
- [x] SQL migration runner, **query builder**, **schema introspection**, seeder, query profiler
- [x] First-party ORM — `@streetjs/orm` (dialects, metadata, migrations, repositories)

### Auth & security
- [x] JWT (HMAC-SHA256, `timingSafeEqual`), AES-256-GCM sessions, scrypt vault
- [x] **OAuth 2.0 / OIDC**, **WebAuthn / passkeys**, **MFA**, **mTLS**
- [x] **RBAC** decorators and helpers
- [x] Sliding-window rate limiter, recursive XSS sanitizer, security headers, CORS, CSRF

### Realtime & messaging
- [x] Bounded WebSocket server (heartbeat, typed events) + channels/presence
- [x] Server-Sent Events (heartbeat, backpressure)
- [x] Transports: **Kafka**, **RabbitMQ**, **Redis (RESP/Streams)**, **NATS** (plugin)

### Observability
- [x] **OpenTelemetry** (OTLP traces/metrics/logs), structured JSON logger with correlation IDs
- [x] **Prometheus** `/metrics` + recording/alerting rules, Grafana dashboard, health checks, analytics

### Microservices & architecture
- [x] **HTTP/2** server, **gRPC** (Protocol Buffers parser + server)
- [x] **Circuit breaker**, **service registry** (discovery), distributed lock, CQRS, saga, event bus/store
- [x] **Edge runtime** — `@streetjs/edge`

### Developer experience
- [x] CLI: `create`, `dev`, `build`, `start`, `test`, `generate`, `migrate`, `seed`
- [x] CLI: `info`, `doctor`, `diagnostics`, `audit`, `certify`, `deploy`, `plugin`, `registry`, `upgrade`, `add`
- [x] Project templates (`app`, `saas`, `ai`, `ecommerce`, `realtime-chat`, `dating-app`) + `--frontend react|next|htmx`
- [x] **SDK generators** — TypeScript and Python clients from the OpenAPI spec
- [x] Docker multi-stage build; GitHub Actions CI/CD with npm provenance + signed plugins

---

## Exploring next

These are directions under consideration, not commitments. They are largely
ecosystem- and adoption-driven rather than core-runtime gaps.

- **More official plugins** — expanding the signed `@streetjs/plugin-*` catalog (payments, messaging, regional providers).
- **More database dialects & tooling** — broader introspection and migration diffing.
- **Tutorials & runnable examples** — growing the catalog incrementally (see the [Tutorials & Examples Program](/adoption/tutorials-and-examples-program/)).
- **Community & governance growth** — see the [Adoption & Go-To-Market Roadmap](/adoption/go-to-market-roadmap/).

The honest current gaps are awareness, ecosystem breadth, and community size —
not core capabilities.

---

## How to influence the roadmap

- **Open a feature request** at [github.com/hassanmubiru/StreetJS/issues](https://github.com/hassanmubiru/StreetJS/issues)
- **Start a discussion** at [github.com/hassanmubiru/StreetJS/discussions](https://github.com/hassanmubiru/StreetJS/discussions)
- **Vote** on existing issues with 👍
- **Contribute** — see the [Contributing Guide](/contributing/)
