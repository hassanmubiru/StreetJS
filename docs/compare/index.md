---
layout:       default
title:        "Compare"
nav_order:    13
has_children: true
permalink:    /compare/
description:   "How StreetJS compares to Express, Fastify, NestJS, Laravel, and Django — honest feature tables, where each fits, and migration paths."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Compare</span>
<h1>StreetJS vs other frameworks</h1>
<p>Honest, factual comparisons to help you evaluate StreetJS — including where the alternatives are the better choice.</p>
</div>

These pages are written to be **fair**, not promotional. StreetJS is technically
mature but younger than the frameworks below, so its ecosystem and community are
smaller — we say so plainly on each page.

| Comparison | TL;DR |
|------------|-------|
| [StreetJS vs Express](/compare/streetjs-vs-express/) | Express is a minimal router; StreetJS is a batteries-included, typed backend. |
| [StreetJS vs Fastify](/compare/streetjs-vs-fastify/) | Both performance-focused; StreetJS adds DI, ORM, auth, realtime out of the box. |
| [StreetJS vs NestJS](/compare/streetjs-vs-nestjs/) | Similar decorator/DI ergonomics; StreetJS is far lighter on dependencies. |
| [StreetJS vs Laravel](/compare/streetjs-vs-laravel/) | Laravel (PHP) vs a TypeScript-native equivalent feature set. |
| [StreetJS vs Django](/compare/streetjs-vs-django/) | Django (Python) batteries-included vs TypeScript-first with the same breadth. |

## How to read these

Each page has the same structure: a one-line summary, an at-a-glance table, **where
each framework wins**, honest tradeoffs, a short FAQ, and a link to a migration
guide where one exists ([Express](/migration-from-express/),
[Fastify](/migration-from-fastify/), [NestJS](/migration-from-nestjs/)).

> Benchmarks are workload-specific. We do not publish headline "X req/s" numbers
> here because they mislead more than they inform; measure with your own routes,
> payloads, and database. See [Performance](/performance/) for methodology.
