# HTMX Dashboard — StreetJS reference application

A server-rendered, live-updating dashboard built on `@streetjs/plugin-htmx`'s
dependency-free `ViewEngine` — **no SPA, no client build step**. Metric tiles
refresh two ways:

- **HTMX polling** — the page polls `GET /tiles`, which returns an HTML *fragment*
  that HTMX swaps in place (`hx-get` + `hx-swap`).
- **Server-Sent Events** — `GET /events` streams the same tiles fragment on an
  interval for push updates.

This is a *reference app*: a runnable, tested starting point you adapt — not an
npm package. Scaffold your own HTMX project with
`street create my-app --frontend htmx`.

## Run

```bash
# from the repo root (resolves the local workspace packages)
npm run build -w packages/core
npm run build -w packages/plugin-htmx
node examples/reference-apps/htmx-dashboard/server.mjs        # starts on :3000
# open http://localhost:3000
```

HTTP surface:

- `GET /` — full dashboard page (wrapped in the layout). An HTMX request
  (`HX-Request: true`) gets just the page fragment.
- `GET /tiles` — the metric tiles as a bare HTML fragment (the HTMX poll target).
- `GET /events` — Server-Sent Events stream pushing tile updates.
- `GET /health/live`, `GET /health/ready` — liveness/readiness.

## How it's built

`ViewEngine` (`@streetjs/plugin-htmx`) renders `views/{layouts,pages,partials}`
with `{{ escaped }}`, `{{{ raw }}}`, and `{{> partial }}` — a tiny owned engine
with no third-party runtime dependency. The controller returns the full layout for
normal loads and just the fragment for HTMX/SSE updates, so the same templates
serve both paths.

## Verification (executed)

```bash
node examples/reference-apps/htmx-dashboard/smoke-test.mjs    # 12/12 checks, exit 0
```

Smoke covers: full-page layout wrap, HTMX fragment (layout omitted on
`HX-Request`), `/tiles` fragment, the SSE stream emitting a tiles event, and a 404
for unknown routes.

## Security configuration

- The demo metrics are synthetic (a seeded random walk) — no data source to
  protect. For a real dashboard, put the data routes behind `authMiddleware` +
  `requireRoles`, and set the response/SSE behind `securityHeaders`.
- In production set `ALLOWED_ORIGINS`, `JWT_SECRET`, `SESSION_KEY`, `KEK`, `PG_*`.

## Deployment

Reuses the repo's deployment artifacts (`deploy/`): Docker, Kubernetes
(`deploy/helm/street`), or Cloud Run (`deploy/cloud-run/service.yaml`). SSE needs a
host that allows long-lived HTTP responses (and SSE keep-alive through any proxy).
Probes hit `/health/live` and `/health/ready`; validate with
`scripts/deploy/smoke-test.sh`.
