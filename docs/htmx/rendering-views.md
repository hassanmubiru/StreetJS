---
layout:      default
title:       "Rendering Views"
parent:      "HTMX"
nav_order:   2
permalink:   /htmx/rendering-views/
description:  "Layouts, pages and the dependency-free StreetJS view engine — template syntax and ctx.htmx.view."
---

# Rendering Views

`@streetjs/plugin-htmx` ships a tiny, dependency-free view engine (consistent with
StreetJS's minimal-dependency philosophy). No Handlebars/Nunjucks/Eta runtime dep.

## Template syntax

- `{{ path }}` — HTML-escaped interpolation (XSS-safe by default)
- `{{{ path }}}` — raw, unescaped interpolation
- `{{> name }}` — include a partial from `partials/`
- Dotted paths: `{{ user.name }}`

Loops and conditionals are intentionally omitted — compose lists by rendering
partials in your controller (see [Partials & Fragments](/StreetJS/htmx/partials/)).

## Layouts

A layout is any template with a `{{{ body }}}` placeholder:

```html
<!-- src/views/layouts/main.html -->
<!doctype html>
<html><head><title>{{ title }}</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head><body>{{> nav }}<main>{{{ body }}}</main></body></html>
```

## Pages and `ctx.htmx.view`

```ts
@Get('/dashboard')
async dashboard(ctx: StreetContext) {
  ctx.htmx.view('dashboard', { title: 'Dashboard', user });
}
```

- On a **normal navigation**, `view()` renders `pages/dashboard.html` and wraps it
  in the configured layout → a full HTML document.
- On an **HTMX request** (`HX-Request: true`), `view()` returns just the page
  fragment (no layout) so HTMX can swap it in.

Override the layout per call: `ctx.htmx.view('page', data)` uses the default;
pass options through the engine for advanced cases.

## The engine directly

For manual rendering (e.g. composing fragments), use `ctx.htmx.engine`:

```ts
const rows = items.map((it) => ctx.htmx.engine.partial('row', it)).join('');
ctx.htmx.view('list', { rows });   // {{{ rows }}} in the page
```

Next: [Partials & Fragments](/StreetJS/htmx/partials/).
