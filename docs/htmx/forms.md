---
layout:      default
title:       "Forms & CSRF"
parent:      "HTMX"
nav_order:   4
permalink:   /htmx/forms/
description:  "Handle HTMX form submissions in StreetJS with CSRF protection and validation errors returned as HTML fragments."
---

# Forms & CSRF

HTMX posts forms over AJAX and swaps the response. StreetJS handles validation and
CSRF the same way it does for any request — you just return HTML instead of JSON.

## CSRF

Add a hidden CSRF field to forms with the helper (token comes from the StreetJS
session/CSRF layer):

```ts
import { csrfField } from '@streetjs/plugin-htmx';
// in a page's data:
ctx.htmx.view('login', { title: 'Log in', csrf: csrfField(ctx.csrfToken) });
```

```html
<form hx-post="/login" hx-target="#error">
  {{{ csrf }}}
  <div id="error"></div>
  <input name="email" type="email" required>
  <input name="password" type="password" required>
  <button>Log in</button>
</form>
```

The field name defaults to `_csrf`; pass a second argument to match your CSRF
middleware: `csrfField(token, 'csrf_token')`.

## Validation errors as fragments

Return an error fragment targeted at `#error` (HTMX swaps it in) and a non-200
status — HTMX still swaps `4xx` bodies when configured, or use `hx`:

```ts
@Post('/login')
async login(ctx: StreetContext) {
  const { email, password } = ctx.body as { email: string; password: string };
  const user = await this.auth.verify(email, password);
  if (!user) {
    ctx.htmx.fragment('<p class="error">Invalid credentials.</p>', 401);
    return;
  }
  // success → redirect the client (see Authentication)
  ctx.htmx.hx({ redirect: '/dashboard' }).fragment('');
}
```

## Always escape user input

`{{ }}` escapes by default. Only use `{{{ }}}` for HTML you trust (like the CSRF
field or pre-rendered partials).

Next: [Authentication](/StreetJS/htmx/authentication/).
