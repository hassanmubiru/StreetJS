---
layout:       default
title:        "HTMX"
nav_order:    13
has_children: true
permalink:    /htmx/
description:   "Build server-rendered, interactive apps with StreetJS + HTMX — typed controllers that return HTML, with auth, CSRF and realtime built in. No SPA, no build step."
---

<div class="doc-header" markdown="0">
<span class="dh-label">HTMX</span>
<h1>StreetJS + HTMX</h1>
<p>Build interactive, server-rendered apps with typed StreetJS controllers that return HTML. <a href="https://htmx.org">HTMX</a> swaps fragments into the DOM — no SPA, no client build step.</p>
</div>

StreetJS stays frontend-agnostic: HTMX support lives in the optional
[`@streetjs/plugin-htmx`](/StreetJS/plugins/) plugin, never in core. The plugin
ships a dependency-free view engine (layouts + partials), `HX-Request` detection,
`HX-*` response-header helpers, and CSRF form fields.

## Why HTMX on StreetJS

- **One language, one stack** — typed controllers render HTML; no separate SPA.
- **Server-rendered = SEO-friendly** — crawlable HTML by default.
- **Smaller payloads** — send HTML fragments, not a hydrating JS bundle.
- **Batteries already here** — auth, sessions, CSRF, WebSockets and SSE come from core.

## Quick start

```bash
npx @streetjs/cli create my-app --frontend htmx
cd my-app && npm install
```

This scaffolds a server-rendered app: `src/views/{layouts,partials,pages}`, a
`ViewsController`, `public/`, and the `@streetjs/plugin-htmx` dependency. Wire the
middleware (one time, see the generated `HTMX.md`):

```ts
import HtmxPlugin from '@streetjs/plugin-htmx';
import { ViewsController } from './controllers/views.controller.js';

app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'main' }));
app.registerController(ViewsController);
```

## In this section

- [Getting Started](/StreetJS/htmx/getting-started/)
- [Rendering Views](/StreetJS/htmx/rendering-views/)
- [Partials & Fragments](/StreetJS/htmx/partials/)
- [Forms & CSRF](/StreetJS/htmx/forms/)
- [Authentication](/StreetJS/htmx/authentication/)
- [Realtime](/StreetJS/htmx/realtime/)
- [Deployment](/StreetJS/htmx/deployment/)

> `@streetjs/plugin-htmx` is part of the StreetJS ecosystem roadmap. Track status
> in the [plugin marketplace](/StreetJS/plugins/marketplace/) and the
> [changelog](/StreetJS/changelog/).
