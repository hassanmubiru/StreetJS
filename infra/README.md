# StreetJS Deployment

Production deployment artifacts and verification for StreetJS. Every target boots
the same container/app, which exposes:

- `GET /health/live` — liveness (no dependencies)
- `GET /health/ready` — readiness (includes a Postgres reachability check)

**Security-first default:** in `NODE_ENV=production` the app refuses to boot
without `ALLOWED_ORIGINS` set (no accidental wildcard CORS). Always provide
`ALLOWED_ORIGINS`, `JWT_SECRET` (≥32 chars), `SESSION_KEY` (64 hex), `KEK`, and
`PG_*` via your platform's secret store.

## Targets

| Target | Artifact | Verification level |
| --- | --- | --- |
| Docker | `Dockerfile` | ✅ image builds; container boots (prod, clustered); `/health/live` + `/health/ready` → 200 |
| Kubernetes / Helm | `deploy/helm/street/`, `deploy/k8s/` | manifests complete (startup/liveness/readiness probes on verified paths, Service, HPA) |
| AWS Lambda | `@streetjs/edge` lambda adapter | ✅ adapter unit-tested |
| Azure Functions | `@streetjs/edge` azure adapter | ✅ adapter unit-tested |
| Google Cloud Run | `deploy/cloud-run/service.yaml` | manifest authored + YAML-validated |
| Cloudflare Workers | `deploy/cloudflare/wrangler.toml` + `@streetjs/edge` worker adapter | config authored; adapter unit-tested |
| AWS ECS (Fargate) | `deploy/aws-ecs/task-definition.json` | manifest authored + JSON-validated |
| Vercel | `deploy/vercel/vercel.json` + `@streetjs/edge` | config authored |

## Smoke test (any target)

```bash
BASE_URL=https://your-instance bash scripts/deploy/smoke-test.sh
```

Verifies `/health/live` and `/health/ready` return 200; exits non-zero
otherwise, so it can gate a deploy or trigger a rollback.

## Rollback

- **Kubernetes:** `kubectl rollout undo deployment/streetjs`
- **Helm:** `helm rollback streetjs <REVISION>`
- **Cloud Run:** `gcloud run services update-traffic streetjs --to-revisions=PREV=100`
- **ECS:** update the service to the previous task-definition revision
- **Lambda/Workers/Vercel:** redeploy/alias the previous version

## Monitoring

The app emits Prometheus metrics and OpenTelemetry spans (see
`docs/` observability guides and `observability/`). Wire `/health/ready` to your
platform's readiness gate and scrape the metrics endpoint; Grafana dashboards
and Prometheus rules ship under `observability/`.

## CI

`.github/workflows/deploy-verify.yml` validates deployment artifacts in CI.
