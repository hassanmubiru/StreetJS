---
layout:      default
title:       "Partials & Fragments"
parent:      "HTMX"
nav_order:   3
permalink:   /htmx/partials/
description:  "Render named partials and raw HTML fragments, and use HX-* response headers to retarget and trigger."
---

# Partials & Fragments

HTMX swaps HTML fragments into the page. StreetJS gives you three ways to produce them.

## Named partials

A partial is a template under `partials/`:

```html
<!-- src/views/partials/todo-item.html -->
<li id="todo-{{ id }}">{{ text }}</li>
```

```ts
@Post('/todos')
async add(ctx: StreetContext) {
  const todo = await this.todos.create(ctx.body);
  ctx.htmx.partial('todo-item', todo);   // returns just the <li>
}
```

With `hx-target="#todos" hx-swap="beforeend"` on the form, the new `<li>` appends
to the list — no full reload.

## Raw fragments

```ts
ctx.htmx.fragment(`<span class="badge">${count}</span>`);
```

## Composing lists

Render a partial per item in the controller and inject with `{{{ }}}`:

```ts
const todos = items.map((t) => ctx.htmx.engine.partial('todo-item', t)).join('');
ctx.htmx.view('home', { todos });   // page has <ul id="todos">{{{ todos }}}</ul>
```

## HX-* response headers

`ctx.htmx.hx({...})` sets HTMX response headers, then chain a render:

```ts
ctx.htmx
  .hx({ trigger: 'todoAdded', retarget: '#todos', reswap: 'beforeend' })
  .partial('todo-item', todo);
```

Supported: `redirect`, `location`, `pushUrl`, `replaceUrl`, `refresh`, `retarget`,
`reswap`, `reselect`, `trigger`, `triggerAfterSettle`, `triggerAfterSwap`. Object
and array triggers are serialized for you.

## Detecting HTMX requests

```ts
if (ctx.htmx.isHtmx) { /* return a fragment */ } else { /* full page */ }
```

`ctx.htmx.view()` already does this automatically; use `isHtmx` for custom branching.

Next: [Forms & CSRF](/StreetJS/htmx/forms/).
