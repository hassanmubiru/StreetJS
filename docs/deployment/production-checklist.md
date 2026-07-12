---
layout:      default
title:       "Production Deployment Checklist"
permalink:   /deployment/production-checklist/
nav_exclude: true
description:  "Operational checklist for running StreetJS in production — required secrets, PostgreSQL HA, Redis Cluster, TLS, reverse proxy, monitoring/OpenTelemetry, rolling upgrades, disaster recovery, and supply-chain verification."
---

# Production Deployment Checklist

A task-oriented checklist for taking a StreetJS app to production. Pairs with
[Docker](./docker.md) and the [Hosting Guide](./hosting-guide.md). Commands assume
the app was scaffolded with `street create` (Node ≥ 22).

Run `street doctor` at any point — it checks Node ≥ 22, TypeScript, required
`.env` vars, and database connectivity.

---

## 1. Required configuration (fail-fast in production)

In `NODE_ENV=production` the app **refuses to start** without these — by design.
The CLI loads `<cwd>/.env` automatically (real shell/CI env vars take precedence).

| Variable | Required | Notes |
|----------|:--------:|-------|
| `JWT_SECRET` | yes | ≥ 32 chars — `openssl rand -hex 24` |
| `SESSION_KEY` | yes | exactly 64 hex chars — `openssl rand -hex 32` |
| `CORS_ORIGINS` | yes | comma-separated allowlist; **no wildcard fallback in prod** |
| `PORT` / `HOST` | no | default `3000` / `0.0.0.0` |
| DB config | yes | SQLite (`DB_DRIVER=sqlite`, `SQLITE_PATH`) or Postgres (`DB_DRIVER=postgres`, `PG_HOST`/`PG_PORT`/`PG_DATABASE`/`PG_USER`/`PG_PASSWORD`) |

> Never commit real secrets. Provide them via your platform's secret manager or a
> deployment-time `.env` that is not in source control.

---

## 2. Database

- **SQLite** is fine for single-node/edge and zero-config starts; the app creates
  its schema at runtime.
- **PostgreSQL** for anything multi-instance. Apply schema migrations with:
  ```bash
  street migrate:run     # requires DB_DRIVER=postgres + PG_* (PostgreSQL-dialect)
  ```
  `migrate:run` is PostgreSQL-only; on a SQLite project it prints the exact steps to
  switch. Keep migrations in `./migrations` (ordered, `NNN_name.sql`).

### PostgreSQL HA (1.2+)

For primary/replica topologies use `PgHaClient` (multi-host, primary discovery via
`pg_is_in_recovery()`, role routing, automatic failover):

```typescript
import { PgHaClient } from 'streetjs'; // or 'streetjs/pg-ha'
const db = new PgHaClient({
  hosts: [{ host: 'pg-a', port: 5432 }, { host: 'pg-b', port: 5432 }],
  user, password, database, target: 'primary',
});
```
See the [HA Data Clients guide](../ha-clients.md). On failover the client
re-discovers the topology and routes writes to the promoted primary.

### Redis Cluster (1.2+)

Use `RedisClusterClient` (slot routing + `MOVED`/`ASK` handling) with seed nodes; see
the same guide.

---

## 3. Build & run

```bash
npm ci
npm run build          # street build → dist/
NODE_ENV=production npm start   # street start → node dist/main.js
```
Containerize with the scaffold's `Dockerfile` (multi-stage, distroless runtime) — see
[Docker](./docker.md). The image runs as non-root and `EXPOSE`s the app port.

---

## 4. TLS & reverse proxy

Terminate TLS at a reverse proxy (nginx/Caddy/Traefik) or the platform load
balancer, and forward to the app port. Set `CORS_ORIGINS` to the public HTTPS
origin(s). For DB/broker links, the core clients support TLS options
(`tls`/`tlsRejectUnauthorized`/`tlsServerName`/`tlsCa`) — enable them for any
connection that leaves the host.

---

## 5. Monitoring & observability

- Scrape the app's metrics/health endpoints (the scaffold ships a health
  controller; `/health` returns status + uptime + memory).
- OpenTelemetry: the core `telemetryMiddleware` + OTel exporter can push traces to
  an OTLP endpoint — set your collector endpoint via env and wire the middleware in
  `main.ts` (the scaffold already registers `telemetryMiddleware`).
- Prometheus rule examples live under `infra/monitoring/prometheus/`.

---

## 6. Scaling & rolling upgrades

- The app boots a cluster primary + worker processes; scale horizontally by running
  multiple instances behind the proxy/LB. HPA example:
  `infra/kubernetes/hpa-autoscaling-example.yaml`.
- **Rolling upgrade:** deploy the new version to a subset, health-check `/health`,
  then shift traffic. Because releases are additive/SemVer-honest within 1.x, a
  rolling mix of adjacent 1.x patch/minor versions is safe. Run
  `street migrate:run` (additive migrations) **before** routing traffic to the new
  version.

---

## 7. Disaster recovery

- **Postgres:** rely on streaming replication (see HA above) + regular `pg_dump`/
  base backups + PITR (WAL archiving). Test restore into a scratch instance.
- **SQLite:** back up the DB file (or use a durable volume); `:memory:` is ephemeral.
- Keep `.env`/secrets in a recoverable secret store, not only on the host.

---

## 8. Supply-chain verification (before you trust an artifact)

StreetJS publishes with npm **provenance (SLSA)** and cosign-signed release tarballs.

```bash
# npm provenance
npm view streetjs@<version> --json | grep -q attestations && echo "provenance present"

# cosign-signed release tarball (from the GitHub Release assets)
cosign verify-blob --bundle streetjs-<version>.tgz.cosign.bundle streetjs-<version>.tgz
```
Official plugins carry signed manifests verified at install (`street plugin install`).

---

## Quick checklist

- [ ] `JWT_SECRET`, `SESSION_KEY`, `CORS_ORIGINS` set (prod fails fast otherwise)
- [ ] DB configured; `street migrate:run` applied (Postgres) or SQLite volume durable
- [ ] `street doctor` passes
- [ ] TLS terminated; DB/broker TLS enabled for off-host links
- [ ] Health checks wired to the proxy/LB; metrics/OTel exported
- [ ] HA clients configured if using PG replicas / Redis Cluster
- [ ] Backups + tested restore
- [ ] Artifact provenance + cosign signature verified
