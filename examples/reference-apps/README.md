# StreetJS Reference Applications

Production-shaped reference backends, each built on verified StreetJS modules
and each with an **executable end-to-end smoke test**. These are runnable
starting points (not npm packages).

| App | Built on | Smoke test | Highlights |
|---|---|---|---|
| `realtime-chat` | `streetjs` (ChannelHub, WS server) | 8 checks + benchmark | auth on upgrade, rooms, presence, typing, history; ~115K deliveries/s |
| `ai-assistant` | `@streetjs/ai` | 5 checks | RAG ingest/ask grounded retrieval, tool-calling loop |
| `ecommerce` | `@streetjs/commerce` | 3 checks | checkout + coupon, no-oversell, cancel/refund/restock |
| `saas` | `@streetjs/admin` | 3 checks | RBAC wildcards, suspension, audit log |
| `dating` | `@streetjs/dating-profiles` | 3 checks | encrypted bios, reciprocal matching |

## Run any app

```bash
npm run build            # build core + cli
node examples/reference-apps/<app>/server.mjs    # standalone HTTP on :3000
```

Each app exposes `GET /health/live` and `GET /health/ready` and is deployable via
the repo's `deploy/` artifacts (Docker, Helm/K8s, Cloud Run). Validate a running
instance with `scripts/deploy/smoke-test.sh`.

## Verify them all (executed)

```bash
bash scripts/verify-reference-apps.sh
```

Runs every app's smoke test; exits non-zero if any fails. Also wired into CI
(`.github/workflows/reference-apps.yml`).

## Security & scaling

Each README notes auth, input limits, and the path to horizontal scale (e.g.
Redis pub/sub in front of `ChannelHub`, a real vector store for the assistant,
Postgres-backed stores for commerce/admin/dating — all demonstrated in the
corresponding `@streetjs/*` packages).
