# HTMX frontend

This project renders HTML on the server and uses [HTMX](https://htmx.org) to swap
fragments — no SPA, no client build step. Powered by `@streetjs/plugin-htmx`.

## Wire it up (one-time)

Add these lines to `src/main.ts`:

```ts
import HtmxPlugin from '@streetjs/plugin-htmx';
import { MarzPayPlugin } from '@streetjs/plugin-marzpay';
import { ViewsController } from './controllers/views.controller.js';
import { MarzPayViewsController } from './controllers/marzpay.controller.js';

// after the other app.use(...) middleware:
app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'main' }));
// MarzPay injects a client into ctx.state['marzpay'] for the controller below:
app.use(MarzPayPlugin({ apiKey: process.env.MARZPAY_API_KEY!, secretKey: process.env.MARZPAY_SECRET!, environment: 'sandbox' }));
// with the other app.registerController(...) calls:
app.registerController(ViewsController);
app.registerController(MarzPayViewsController);
```

## MarzPay (server-rendered, no SPA)

`@streetjs/plugin-marzpay` powers server-rendered checkout. The fragments under
`src/views/pages/marzpay/` submit via `hx-post`; `marzpay.controller.ts` calls the
injected client and swaps in the response:

```
src/views/pages/marzpay/
  checkout.html       # payment initialization form (hx-post /marzpay/checkout)
  redirect.html       # redirect-handling fragment (verified redirect_url)
  status.html         # payment status display (hx-post /marzpay/status)
  subscription.html   # subscription management (hx-post /marzpay/subscription)
  failure.html        # failure fragment — returned on error/non-success, never a redirect
src/controllers/marzpay.controller.ts
```

On a verified card initialization the controller returns the redirect fragment
(and an `HX-Redirect` to MarzPay's `redirect_url`); on error or a non-success
result it returns the failure fragment and never a redirect.

## Layout

```
src/views/
  layouts/main.html      # contains {{{ body }}}; loads htmx
  partials/              # nav, todo-item
  pages/                 # home, login, register, dashboard
public/app.css
```

Template syntax: `{{ x }}` (escaped), `{{{ x }}}` (raw), `{{> name }}` (partial).
Compose lists by rendering partials in the controller (see `views.controller.ts`).

Docs: https://hassanmubiru.github.io/StreetJS/starters/
