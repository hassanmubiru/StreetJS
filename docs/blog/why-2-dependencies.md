---
layout:      default
title:       "Why StreetJS has two runtime dependencies"
permalink:   /blog/why-2-dependencies/
nav_exclude: true
description:  "How StreetJS ships a full TypeScript backend — HTTP, routing, DI, native PostgreSQL, WebSockets, auth, jobs — with only two runtime dependencies, and why that matters for security and cost."
---

{% include doc-styles.html %}

<div class="doc-header" markdown="0">
<span class="dh-label">Engineering</span>
<h1>Why StreetJS has two runtime dependencies</h1>
<p>A full backend framework with HTTP, routing, DI, a native PostgreSQL driver, WebSockets, auth, and jobs — shipped with two runtime dependencies. Here's how, and why it matters.</p>
</div>

Most Node backends pull in hundreds of transitive packages before you write a
line of business logic. Each one is attack surface, a supply-chain risk, and a
potential breaking change. StreetJS takes the opposite position: implement the
hard parts directly on Node core, and depend on almost nothing.

## The two dependencies

StreetJS (`streetjs`) ships with exactly two runtime dependencies:

- **`reflect-metadata`** — decorator metadata for constructor injection.
- **`ws`** — WebSocket framing.

Everything else — the HTTP server, router, dependency-injection container, the
PostgreSQL wire-protocol driver, security primitives, the job queue, clustering,
and OpenAPI generation — is built on Node's standard library (`node:net`,
`node:http`, `node:crypto`, `node:cluster`, `node:stream`).

## "But isn't that reinventing the wheel?"

For application code, reusing libraries is usually right. For a framework's
**core**, every dependency you adopt becomes a dependency your users inherit —
transitively, forever. A native implementation means:

- **Smaller attack surface.** Fewer packages means fewer places for a
  supply-chain compromise to hide. It also makes an SBOM short enough to actually
  read.
- **No version-range roulette.** The framework can't break because a transitive
  dependency shipped a bad minor.
- **Bounded behavior.** Implementing the PostgreSQL wire protocol directly means
  StreetJS controls backpressure, memory limits, and auth (SCRAM-SHA-256) instead
  of inheriting whatever a third-party driver does.

## The native PostgreSQL driver

The clearest example: instead of depending on `pg`, StreetJS speaks PostgreSQL
wire protocol v3 over `node:net`, with SCRAM-SHA-256 authentication and
socket-level streaming. You write ordinary, parameterized queries:

```typescript
const { rows } = await pool.query(
  'SELECT id, name FROM items WHERE owner_id = $1 ORDER BY created_at DESC',
  [ownerId],
);
```

No `pg`, no `pg-pool`, no native bindings to compile. The same philosophy gives
you native MySQL, MongoDB, Redis, Kafka, and AMQP clients in the official
[plugins](/StreetJS/plugins/marketplace/) — each dependency-free.

## What it buys you

- **Cost.** A self-hosted StreetJS service replaces several managed services
  (auth, realtime, a queue) with in-process features, on a single small VPS.
- **Trust.** Provenance-signed releases plus a tiny dependency tree make security
  review tractable. See the [Security & Trust Center](/StreetJS/trust/).
- **Longevity.** Fewer moving parts means fewer forced upgrades.

## The tradeoff, honestly

Native implementations mean the StreetJS team maintains protocol code that other
frameworks delegate. That's a real cost — paid by maintainers, not users — and
it's why the work is covered by wire-protocol, fuzz, load, and chaos test suites
in CI. The dependency-free invariant is a deliberate, defended design choice, not
an accident.

---

*Start with `npx @streetjs/cli create my-app` — see [Getting Started](/StreetJS/getting-started/installation/).*
