---
layout:      default
title:       "HTMX Dashboard — built with StreetJS"
permalink:   /showcase/htmx-dashboard/
nav_exclude: true
description:  "A server-rendered, interactive dashboard built with StreetJS and @streetjs/plugin-htmx — HTML fragments + SSE, no SPA build step."
---

# HTMX Dashboard — built with StreetJS

**Server-rendered HTML · HTMX swaps · SSE live tiles — no SPA build step.**

- **Live demo:** _coming soon_ (see the [demo plan](https://github.com/hassanmubiru/StreetJS/blob/main/DEMO-INFRA-PLAN.md))
- **Source:** [`examples/reference-apps/htmx-dashboard`](https://github.com/hassanmubiru/StreetJS/tree/main/examples/reference-apps/htmx-dashboard)
- **Scaffold your own:** `street create my-app --frontend htmx`
- **Deploy:** [`deploy/`](https://github.com/hassanmubiru/StreetJS/tree/main/deploy) · **Docs:** [Plugins](/StreetJS/plugins/htmx/)

## Architecture

```
Browser (HTMX, no SPA build) ─▶ typed @Controller
                                   ├─ @streetjs/plugin-htmx view engine (layouts/partials)
                                   ├─ returns HTML fragments (hx-get/hx-post → swap)
                                   └─ SSE channel ─▶ live-updating tiles (no client framework)
```

The controller returns real HTML fragments that HTMX swaps into the page; live
tiles update over Server-Sent Events. The whole interactive surface ships without
a client bundler — typed controllers all the way down.

## Run it locally

```bash
npm run build -w packages/core
npm run build -w packages/plugin-htmx
cat examples/marzpay-htmx/README.md      # run instructions
```

## Status

The current HTMX example is checkout-focused; a dedicated dashboard (live SSE
tiles + HTMX-swapped panels, reusing the Live Dashboard patterns) is the next
build step in the [Showcase Roadmap](https://github.com/hassanmubiru/StreetJS/blob/main/SHOWCASE-ROADMAP.md).

## Learning path

1. [Live Dashboard](/StreetJS/showcase/) — SSE metrics streaming
2. HTMX frontend (`--frontend htmx`)
3. Server-rendered dashboard (fragments + SSE)

> Browse all demos in the [Showcase](/StreetJS/showcase/).
