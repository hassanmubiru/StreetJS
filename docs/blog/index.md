---
layout:       default
title:        "Blog"
nav_order:    99
has_children: false
permalink:    /blog/
description:   "StreetJS blog — release notes, deep dives, and ecosystem updates."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Blog</span>
<h1>Blog</h1>
<p>Release notes, engineering deep dives, and ecosystem updates.</p>
</div>

The blog is just getting started. In the meantime:

## Latest

- [**Why StreetJS has three runtime dependencies**](/blog/why-2-dependencies/) — how a full backend ships on Node core with three deps, and why that matters for security and cost.
- [**Talking to PostgreSQL without the `pg` package**](/blog/native-postgres-driver/) — the wire-protocol v3 + SCRAM-SHA-256 native driver, and why it exists.
- [**Self-hosting a full backend on one small VPS**](/blog/self-hosting-cost/) — the cost case for in-process auth/realtime/jobs, with measured numbers.

## More

- **What's changing release to release:** [Changelog](/changelog/)
- **Where the project is headed:** [Roadmap](/roadmap/) · [Go-To-Market Roadmap](/adoption/go-to-market-roadmap/)
- **Learn by building:** [Tutorials](/tutorials/) · [Examples](/examples/)
- **Honest status:** [Full Report](/STREETJS-FULL-REPORT/) · [Gap Analysis](/STREETJS-GAP-ANALYSIS/)

## Suggested first posts

Planned topics (contributions welcome — see [Community](/community/)):

1. *Why StreetJS has so few dependencies* — the case for a native-driver, fully integrated core.
2. *Self-hosting a full backend for under $10/month* — based on the [budget guide](/deployment/budget/).
3. *Signing the plugin ecosystem* — Ed25519 manifests, provenance, and the trust model.
4. *From SQLite to PostgreSQL without rewrites* — the shared repository pattern.

> Want to write one? Open a [Discussion](https://github.com/hassanmubiru/StreetJS/discussions) or a PR.
