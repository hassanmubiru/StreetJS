<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-htmx

**First-class [HTMX](https://htmx.org) support for StreetJS** — a dependency-free
view engine (layouts + partials), `HX-Request` detection, `HX-*` response-header
helpers, and CSRF form fields. Build server-rendered, interactive apps with typed
controllers that return HTML — no SPA, no client build step.

StreetJS stays frontend-agnostic: HTMX lives here, in an optional plugin, never in core.

## Install

```bash
npm install @streetjs/plugin-htmx
```

## Quick start

```ts
import { HtmxPlugin } from '@streetjs/plugin-htmx';

app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'main' }));

// in a controller — full page on first load, fragment on an HTMX request:
ctx.htmx.view('dashboard', { user });

// render a partial (no layout):
ctx.htmx.partial('users/row', { user });

// HX response controls:
ctx.htmx.hx({ trigger: 'userCreated', retarget: '#list', reswap: 'beforeend' })
        .partial('users/row', { user });
```

### Views layout

```
src/views/
  layouts/main.html      # contains {{{ body }}}
  partials/row.html
  pages/dashboard.html
```

### Template syntax (dependency-free engine)

- `{{ path }}` — HTML-escaped interpolation
- `{{{ path }}}` — raw interpolation
- `{{> name }}` — include a partial from `partials/`

Compose lists by rendering partials in your controller (loops/conditionals are a
planned addition — see the docs roadmap).

## API

- `HtmxPlugin.middleware({ viewsDir, layout?, ext?, cache? })` — attaches `ctx.htmx`.
- `ctx.htmx.view(page, data?, status?)` / `.partial(name, data?, status?)` / `.fragment(html, status?)`
- `ctx.htmx.hx({ redirect, location, pushUrl, trigger, retarget, reswap, … })`
- `ctx.htmx.isHtmx` — whether the request came from HTMX
- Pure helpers: `isHtmxRequest(headers)`, `hxHeaders(init)`, `csrfField(token)`,
  `renderTemplate(src, data, resolve)`, `escapeHtml(v)`, and the `ViewEngine` class.

## License

MIT
