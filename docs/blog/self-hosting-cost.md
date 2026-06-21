---
layout:      default
title:       "Self-hosting a full backend on one small VPS"
permalink:   /blog/self-hosting-cost/
nav_exclude: true
description:  "Auth, realtime, jobs, cache and a database driver run in-process in StreetJS — replacing several managed services. Here's what that means for cost, with measured numbers."
---

{% include doc-styles.html %}

<div class="doc-header" markdown="0">
<span class="dh-label">Architecture</span>
<h1>Self-hosting a full backend on one small VPS</h1>
<p>Auth, realtime, jobs, cache and native database drivers run in-process — so a single small server can replace several managed services. Here's the cost case, with measured numbers.</p>
</div>

A typical "serverless-ish" SaaS stack rents auth (Auth0), realtime (Pusher/Ably),
a queue (a managed Redis + worker), and a managed database. Each is a monthly
bill that scales with usage. StreetJS folds most of those into the framework
itself, so they run in one process on hardware you already pay for.

## What's in-process

- **Auth** — JWT, sessions, RBAC, MFA (no external auth service required).
- **Realtime** — a bounded WebSocket server + SSE (no Pusher/Ably).
- **Jobs** — a PostgreSQL-backed queue, cron, and a saga engine (no Redis/worker tier).
- **Cache** — optional via the dependency-free [Redis plugin](/StreetJS/plugins/redis/).
- **Database** — native PostgreSQL/MySQL drivers; SQLite for the smallest setups.

## Measured numbers

From the [budget deployment guide](/StreetJS/deployment/budget/) (all marked
MEASURED, reproducible from the repo's benchmarks):

- **~5,700 requests/second** single-process throughput (5,000 requests, 0 errors).
- **~30 KB per WebSocket** connection at 1,000 connections with 100% delivery —
  so ~10,000 connections is on the order of ~300 MB of RAM.

> These are measured on the project's own benchmark harness. Your numbers depend
> on workload and hardware — always benchmark your own path. StreetJS publishes
> only measured figures, never estimates.

## What that enables

One modest VPS can serve real traffic and realtime connections while the features
that would otherwise be separate SaaS bills run alongside your app. The tradeoff
is operational: you run the box. For teams optimizing total cost of ownership and
avoiding vendor lock-in, that's the point.

## Getting started

```bash
npx @streetjs/cli create my-app --database postgres
cd my-app && npm install && street dev
```

Deploy with the included Dockerfile, or follow the
[budget guide](/StreetJS/deployment/budget/) for a single-VPS setup. For the
trust/SBOM/provenance evidence enterprises ask about, see the
[Security & Trust Center](/StreetJS/trust/).

---

*Build a SaaS in one command: `street create my-app --starter saas` — see [Starters](/StreetJS/starters/).*
