---
layout:    default
title:     "StreetJS vs Laravel"
parent:    "Compare"
nav_order: 4
permalink: /compare/streetjs-vs-laravel/
description: "StreetJS vs Laravel compared — a fully integrated PHP framework vs a TypeScript-native backend with a comparable feature set (ORM, auth, queues, realtime)."
---

# StreetJS vs Laravel

**In one line:** Laravel is the gold standard for integrated web
development in PHP; StreetJS brings a comparable integrated feature set to a
TypeScript/Node stack.

The biggest difference is the **language and runtime**: PHP for Laravel,
TypeScript on Node.js for StreetJS. Choose the ecosystem your team is productive
in first.

---

## At a glance

| | StreetJS | Laravel |
|---|---|---|
| Language / runtime | TypeScript / Node.js | PHP |
| ORM | `@streetjs/orm` (decorators, relations, migrations) | Eloquent (mature, expressive) |
| Auth / RBAC / MFA | Built in | Built in (Breeze/Jetstream/Fortify) |
| Queues / jobs | Job runner | Queues + Horizon (very mature) |
| Realtime | Built-in WebSockets + channels | Broadcasting + Echo (+ driver) |
| Templating / frontend | Typed client SDK + React/Vue/Next/Nuxt | Blade + Inertia/Livewire |
| Ecosystem & community | Smaller / younger | Very large, mature |

---

## Where Laravel wins

- **Maturity & ecosystem:** Eloquent, Horizon, Forge, Vapor, Nova, and a vast
  package ecosystem; enormous community and learning resources.
- **Developer happiness:** a famously polished DX with conventions for nearly
  everything.
- **Hiring pool:** huge.

## Where StreetJS wins

- **One language across the stack:** TypeScript on both backend and frontend,
  with a shared typed client.
- **Node concurrency model** for IO-bound, realtime-heavy workloads.
- **Dependency-light, native drivers** rather than a large framework runtime.

## Honest tradeoffs

Laravel is vastly more mature with a far larger ecosystem and community. If your
team is in PHP or wants the deepest integrated experience available today,
Laravel is the safe, excellent choice. StreetJS is for teams that want a similar
breadth in a TypeScript-first, Node-native stack.

## FAQ

**Does StreetJS have an Eloquent equivalent?**
`@streetjs/orm` provides entity decorators, relations, eager loading, and
model-driven migrations. Eloquent is more mature, but the core patterns map.

**Can I do queues and realtime like Laravel?**
Yes — a background job runner and built-in WebSockets/channels cover the common
queue + broadcasting use cases.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {"@type": "Question", "name": "Does StreetJS have an Eloquent equivalent?", "acceptedAnswer": {"@type": "Answer", "text": "@streetjs/orm provides entity decorators, relations, eager loading, and model-driven migrations. Eloquent is more mature, but the core patterns map across."}},
    {"@type": "Question", "name": "Can StreetJS handle queues and realtime like Laravel?", "acceptedAnswer": {"@type": "Answer", "text": "Yes. StreetJS includes a background job runner and built-in WebSockets with channels, covering common queue and broadcasting use cases."}}
  ]
}
</script>
