# StreetJS showcase demos — turnkey hosting

Run a live, clickable instance of every showcase capability with one command.
This is the executable form of `DEMO-INFRA-PLAN.md`: one Docker image runs any
reference app (selected by `$DEMO_APP`), and Caddy fronts them with auto-TLS and
per-subdomain routing.

> **Status: authored + compose-validated.** The compose file passes
> `docker compose config`. Stand it up on a host (the image builds the workspace
> packages with network access for the SQLite WASM download) and smoke-test before
> advertising any URL — never flip a demo to `live` until `/health/ready` passes.

## Demos included

| Service | Capability | Subdomain (with TLS) |
|---|---|---|
| `saas` | Auth · RBAC · Multi-tenant · Audit | `saas.$DEMO_DOMAIN` |
| `crm` | Contacts · Deals · Pipeline · RBAC | `crm.$DEMO_DOMAIN` |
| `htmx-dashboard` | Server-rendered HTML · HTMX · SSE | `htmx.$DEMO_DOMAIN` |
| `realtime-chat` | WebSockets · presence · channels | `chat.$DEMO_DOMAIN` |
| `ai-assistant` | RAG · embeddings · tool-calling | `ai.$DEMO_DOMAIN` |

Each is a real, CI-tested reference app (`examples/reference-apps/*`) with an
executable `smoke-test.mjs`.

## Run it

```bash
# Local (HTTP, demo.localhost):
docker compose -f demos/docker-compose.yml up -d --build
docker compose -f demos/docker-compose.yml ps      # all healthy?

# Hosted (real domain + auto-TLS):
export DEMO_DOMAIN=demo.streetjs.dev               # point *.demo.streetjs.dev at the host
docker compose -f demos/docker-compose.yml up -d --build
```

Then verify and surface the live URLs:

```bash
# 1) add the URLs to docs/_data/demos.json (url + status: "live"), or
# 2) let the probe set them:
node scripts/check-demos.mjs            # report
node scripts/check-demos.mjs --write    # flip live/down in demos.json
```

The showcase + homepage "Live demo" badges render from `demos.json`, so once a
URL is set and `/health/ready` passes, the badge goes green automatically.

## Safety (mandatory for public demos)

- **Synthetic/seed data only** — no real PII. Every store is in-memory and resets
  on container restart; schedule `docker compose restart` (cron) to wipe drift.
- **MarzPay billing demo:** host it with **sandbox** `MARZPAY_*` keys only — no real
  money. (Not in this compose by default; add the env when you host it.)
- **AI assistant:** run with a budget-capped key behind rate limiting **or** a
  canned/fixture mode (`DEMO-INFRA-PLAN.md` §4) so the public demo can't overspend.
- **Resource caps:** each service has `mem_limit: 256m`; add edge rate limiting in
  Caddy for public exposure.

## How it works

`demos/Dockerfile` builds the workspace packages the reference apps import
(`core`, `admin`, `ai`, `commerce`, `dating-profiles`, `plugin-htmx`) and runs
`examples/reference-apps/$DEMO_APP/server.mjs`. `demos/Caddyfile` maps each
subdomain to a service. Every app exposes `/health/live` + `/health/ready` for the
Docker healthcheck and the uptime probe (`scripts/check-demos.mjs`,
`.github/workflows/demos-uptime.yml`).
