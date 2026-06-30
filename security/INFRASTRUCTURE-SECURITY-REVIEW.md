# StreetJS Infrastructure Security Review

> Review of `infra/` (Docker, compose, k8s, helm, provider examples, monitoring).
> Read-only. Evidence-based against the moved infra assets.

## Scope (VERIFIED, post-Phase-2 layout)
```
infra/docker/Dockerfile              infra/docker/compose/docker-compose*.yml (×6)
infra/kubernetes/hpa-autoscaling-example.yaml
infra/helm/street/                   infra/examples/{aws-ecs,cloud-run,cloudflare,vercel}
infra/monitoring/{prometheus,grafana}
```
Plus `packages/registry-server/Dockerfile` (service image — KEEP).

## Findings

| Severity | Asset | Issue | Recommendation |
|---|---|---|---|
| **MEDIUM** | `docker-compose.yml`, `docker-compose.test-db.yml` | Services bind to **all interfaces** (`"5432:5432"`, `"3000:3000"`, `"5433:5432"`, `"3306:3306"`) | For local dev, bind to loopback: `"127.0.0.1:5432:5432"` so DBs aren't exposed on the LAN |
| **LOW** | same | **Default dev passwords** (`street_secret`, `testpass`) + placeholder `JWT_SECRET`/`KEK` (`change-me-in-production-…`) | Acceptable for local dev (clearly labelled). Document "never use in prod"; require real values via secret store in prod compose/Helm |
| **LOW** | `docker-compose.test-db.yml` mysql | `--default-authentication-plugin=caching_sha2_password` over non-TLS | Test-only; fine. Note plaintext auth on the wire for local |
| **LOW** | all DB/cache compose | No TLS between app and DB/broker | Dev convenience; production guidance should mandate TLS (see plugin TLS gap) |
| **INFO** | `infra/Dockerfile` | Multi-stage, distroless runtime (`gcr.io/distroless/nodejs22`), pinned base by digest | ✅ good posture — non-root distroless, pinned digests |
| **INFO** | `infra/helm/street`, `infra/kubernetes` | Liveness/readiness/startup probes, HPA example | ✅ present |
| **VERIFIED** | all infra | No real cloud account IDs / ARNs / internal DNS / cluster names | ✅ templated only (enforced by `scan-infra-identifiers` job) |

## Exposed-services summary
| Service | Port | Exposure | Notes |
|---|---|---|---|
| postgres (compose) | 5432 | host all-ifaces | dev; bind loopback |
| street-app | 3000 | host all-ifaces | dev |
| postgres (test-db) | 5433 | host all-ifaces | test |
| mysql (test-db) | 3306 | host all-ifaces | test |
No services are deployed publicly by these files — they are local/test compose + templated cloud manifests.

## TLS guidance (currently missing — RECOMMENDATION)
- Add a `infra/README` section: production deployments must terminate TLS at the
  ingress/load balancer; DB/broker connections should use TLS where the provider
  supports it. The framework plugins (redis/mongodb/nats/kafka/rabbitmq) currently
  default to plaintext (see `PLUGIN-SECURITY-AUDIT.md`); document this for operators.

## Hardening checklist
- [ ] Bind local compose DB ports to `127.0.0.1`.
- [ ] Add prod-vs-dev compose split (or document required env overrides).
- [ ] Document TLS-at-ingress + DB TLS guidance in `infra/README.md`.
- [ ] Keep base-image digests pinned (already done in `infra/docker/Dockerfile`).
- [x] No real identifiers in infra (CI-enforced).
