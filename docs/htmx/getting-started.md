---
layout:      default
title:       "Getting Started"
parent:      "HTMX"
nav_order:   1
permalink:   /htmx/getting-started/
description:  "Scaffold and run a server-rendered StreetJS + HTMX app, and understand the request lifecycle."
---

# Getting Started with HTMX

## Scaffold

```bash
npx @streetjs/cli create my-app --frontend htmx
cd my-app && npm install
```

You get a server-rendered project:

```
src/
  views/
    layouts/main.html      # loads htmx, contains {{{ body }}}
    partials/              # nav, todo-item
    pages/                 # home, login, register, dashboard
  controllers/views.controller.ts
public/app.css
HTMX.md                    # one-time wiring instructions
```

## Register the plugin

Add to `src/main.ts` (see `HTMX.md`):

```ts
import HtmxPlugin from '@streetjs/plugin-htmx';
import { ViewsController } from './controllers/views.controller.js';

app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'main' }));
app.registerController(ViewsController);
```

`middleware()` attaches `ctx.htmx` to every request.

## Request lifecycle

1. Browser navigates to `/` → controller calls `ctx.htmx.view('home', data)` →
   the plugin renders the **page wrapped in the layout** (full HTML document).
2. HTMX issues a request (e.g. `hx-post="/todos"`) with the `HX-Request: true`
   header → `ctx.htmx.view(...)` returns **just the page fragment** (no layout);
   `ctx.htmx.partial(...)` returns a named partial. HTMX swaps it into the DOM.

That single behavior — full page on navigation, fragment on HX requests — is the
progressive-enhancement story: the app works without JS and gets interactive with it.

## Run

```bash
street dev
```

Next: [Rendering Views](/StreetJS/htmx/rendering-views/).
