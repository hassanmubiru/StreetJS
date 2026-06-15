---
layout:    default
title:     "StreetJS on a Budget"
parent:    "Deployment"
nav_order: 3
permalink: /deployment/budget/
description: "Run production-ready StreetJS apps for under $10, $25, and $50 a month — low-memory operation, SQLite/PostgreSQL, self-hosting, and affordable VPS deployments with security and reliability intact."
---

# StreetJS on a Budget

Run real, production-ready StreetJS apps on cheap infrastructure. This guide is
grounded in **measured** memory/throughput numbers (not estimates) and current VPS
pricing, and shows concrete stacks for **under $10, $25, and $50 per month**.

> **Evidence tags:** **MEASURED** = run this session on Node 20.20 (`scripts/audit/footprint.mjs`, `load-smoke.mjs`, `ws-scale.mjs`). **PRICING** = public list prices as of **June 2026** — *verify current pricing*, the VPS market moved sharply in early 2026.

---

## Why StreetJS is cheap to run

| Property | Measured / evidence | Budget impact |
|----------|---------------------|---------------|
| Tiny idle footprint | **~64 MB RSS** for a bare HTTP server (MEASURED) | Fits a 256–512 MB VPS |
| In-process SQLite | **~94 MB RSS** with SQLite open (MEASURED) | **No separate DB service / no managed DB bill** |
| Dependency-light core | 2 runtime deps (no Express/pg/Prisma) | Smaller image, less RAM, fewer CVEs to patch |
| Single-process throughput | **~5,700 req/s**, 5,000 reqs, 0 errors (MEASURED) | One small VPS serves real traffic |
| Cheap realtime | **~30 KB per WebSocket**, 1,000 conns @ 100% delivery (MEASURED) | 10k connections ≈ ~300 MB — **no managed Pusher/Ably** |
| Batteries included | JWT/sessions/RBAC/MFA, WS/SSE channels, jobs, cache, OpenAPI in core | **Replaces Auth0 / Pusher / a queue / Redis bills** |
| Native drivers | PostgreSQL + MySQL over the wire, SQLite (WASM) | Self-host the DB; skip RDS/managed Postgres |

Reproduce the footprint:
```bash
node --expose-gc scripts/audit/footprint.mjs
# RSS baseline=66MB  http-listening=64MB  +sqlite=94MB
```

---

## The three budget tiers

> VPS examples are representative June-2026 list prices (USD approx; Hetzner billed in EUR). Always confirm current pricing and region.

### Under $10/month — "solo / side-project"
**Stack:** 1 small VPS · StreetJS + **SQLite (in-process)** · Caddy for automatic TLS · litestream/cron backups to object storage.

| Component | Pick | ~Cost/mo |
|-----------|------|---------:|
| Compute | Hetzner **CX22** (2 vCPU, 4 GB) or DigitalOcean $6 droplet (1 GB) | $4–$6 |
| TLS + domain | Let's Encrypt via Caddy (free) + domain | ~$1 (amortized) |
| Storage/backups | Cloudflare **R2** (zero egress) or Backblaze B2, few GB | $0–$1 |
| **Total** | | **~$5–$8** |

Runs comfortably: a SaaS MVP, blog/CMS, internal tool, API + small realtime — all in **<150 MB RSS** (MEASURED headroom on 4 GB).
Even **free**: Oracle Cloud **Always Free** ARM (up to 24 GB RAM) can host this at **$0** compute (PRICING; subject to Oracle's terms/availability).

### Under $25/month — "growing product"
**Stack:** 1 VPS · StreetJS + **self-hosted PostgreSQL** (native driver, same box or a second small box) · Caddy TLS · R2/B2 storage · Prometheus scrape (self-hosted).

| Component | Pick | ~Cost/mo |
|-----------|------|---------:|
| Compute | Hetzner **CPX22/CCX13** (2 vCPU, 8 GB) or Vultr $12–$18 | $9–$18 |
| Postgres | Self-hosted on the same VPS (or a $4–$5 second box) | $0–$5 |
| Object storage | R2 / B2, tens of GB | $1–$3 |
| **Total** | | **~$12–$24** |

Adds: real Postgres (relations + migrations via `@streetjs/orm`), background jobs, search (in-process or Meilisearch on-box), and headroom for thousands of concurrent WebSockets.

### Under $50/month — "production with reliability"
**Stack:** 2 VPS (app + DB separation) · self-hosted PostgreSQL with daily off-box backups · Caddy/HAProxy · object storage · uptime + metrics.

| Component | Pick | ~Cost/mo |
|-----------|------|---------:|
| App server | Hetzner CCX13 / DO 2 vCPU·4 GB | $12–$24 |
| DB server | Dedicated small VPS for Postgres + backups | $9–$18 |
| Storage + backups | R2/B2 + snapshots | $3–$6 |
| Monitoring | Self-hosted Prometheus/Grafana (on-box) or free tier | $0–$5 |
| **Total** | | **~$25–$48** |

Adds: failure isolation (app crash ≠ DB loss), off-box backups (recovery), blue/green via a second app box, and OpenTelemetry/Prometheus dashboards (already in StreetJS).

---

## Architecture recommendations

1. **Start with SQLite, graduate to PostgreSQL.** SQLite is in-process (MEASURED +30 MB) — zero DB service, zero DB bill. StreetJS's `SqlitePool` and `PgPool` share the same query/repository patterns, so migrating later is mechanical. Use Postgres once you need concurrent writers, replication, or >1 app instance.
2. **One process, then scale up before out.** A single StreetJS process served ~5.7k req/s in testing. Vertical scaling (a bigger VPS) is cheaper and simpler than horizontal until you genuinely need HA. Use the built-in cluster module to use all cores on one box.
3. **Replace managed SaaS with built-ins:**
   - Auth → built-in JWT/sessions/RBAC/MFA (skip Auth0/Clerk bills).
   - Realtime → built-in WS/SSE channels (skip Pusher/Ably).
   - Queue/jobs → built-in job runner (skip a managed queue).
   - Cache → in-process LRU / distributed cache (skip a managed Redis until needed).
   - Storage → `@streetjs/plugin-r2` (Cloudflare R2, **zero egress**) or S3/B2.
4. **TLS for free.** Put Caddy in front for automatic Let's Encrypt certificates; StreetJS serves plain HTTP on localhost behind it.
5. **Back up cheaply.** SQLite: stream/snapshot the file to R2/B2 on a cron (or litestream). Postgres: `pg_dump` to object storage daily. Off-box backups are the single highest-ROI reliability spend.

---

## Deployment guide (under $10 reference)

**1. Provision** a CX22 / $6 droplet, create a non-root user, enable the firewall (allow 22/80/443), and unattended-upgrades.

**2. Run StreetJS** under systemd (no Docker needed; smaller footprint):
```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=StreetJS app
After=network.target
[Service]
User=app
WorkingDirectory=/srv/myapp
ExecStart=/usr/bin/node dist/main.js
Environment=NODE_ENV=production PORT=3000
Restart=always
MemoryMax=400M
[Install]
WantedBy=multi-user.target
```

**3. TLS + reverse proxy** with Caddy (automatic HTTPS):
```
# /etc/caddy/Caddyfile
myapp.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

**4. Backups** (SQLite → R2) on a cron:
```bash
# daily: snapshot the SQLite file and upload (rclone → R2/B2)
sqlite3 /srv/myapp/data.db ".backup '/tmp/data.bak'" && rclone copy /tmp/data.bak r2:myapp-backups/$(date +%F)/
```

Prefer containers? The repo ships a **distroless** Dockerfile (non-root, ~small image) and `docker-compose.yml` — see [Docker](/deployment/docker/). One `docker compose up` runs app + Postgres on a single box for the under-$25 tier.

---

## Example applications & expected footprint

| App | DB | Expected RSS | Tier |
|-----|----|-------------:|------|
| Todo / Notes API | SQLite | ~95–120 MB | <$10 |
| Blog / CMS + auth | SQLite→PG | ~110–140 MB | <$10 |
| SaaS starter (RBAC, jobs) | PostgreSQL | ~130–170 MB | <$25 |
| Realtime chat (1k WS) | PG + channels | ~160–200 MB | <$25 |
| Multi-tenant SaaS + search | PG + Meilisearch | ~250–400 MB | <$50 |

Scaffold any of these: `street create my-app --template saas --frontend react` (see the [Tutorials & Examples Program](/adoption/tutorials-and-examples-program/)).

---

## Benchmarks (MEASURED this session, single process)

| Metric | Result | Source |
|--------|--------|--------|
| Idle HTTP RSS | ~64 MB | `footprint.mjs` |
| RSS with SQLite open | ~94 MB | `footprint.mjs` |
| Throughput (1 process, 50 conc) | ~5,700 req/s, 5,000 reqs, **0 errors** | `load-smoke.mjs` |
| 20× start/stop RSS drift | **0 MB** (no leak) | `load-smoke.mjs` |
| WebSocket scale | 1,000 conns, **100% broadcast delivery**, ~30 KB/conn, 0 leaked | `ws-scale.mjs` |

> These are bounded, single-box numbers on a developer machine, not a tuned
> benchmark rig — they establish *order of magnitude* for capacity planning, not
> marketing peak figures. Run them on your target VPS for real sizing.

---

## Cost comparison vs managed equivalents

A typical small SaaS often pays separately for each concern. StreetJS folds most
into one VPS:

| Concern | Common managed cost | StreetJS-on-a-budget |
|---------|--------------------:|----------------------|
| Compute/hosting | Vercel/Render paid tiers $20–$25+ | $4–$18 VPS |
| Managed Postgres | $15–$50+ (RDS/managed) | self-host $0–$5 |
| Auth (Auth0/Clerk) | $0 free → $25–$100+ at scale | built-in $0 |
| Realtime (Pusher/Ably) | $29–$49+ | built-in $0 |
| Object storage egress | S3 egress $0.09/GB | R2 **$0 egress** |
| **Rough total** | **$90–$250+/mo** | **$5–$48/mo** |

The savings are concentrated in **avoided managed-service subscriptions**, not just
cheap compute — that is the core of the StreetJS budget thesis.

---

## Security & reliability on a budget (non-negotiables)

Cheap must not mean insecure. Even on the $5 tier:
- **TLS everywhere** (Caddy/Let's Encrypt, free) and security headers (built-in).
- **Firewall** to 22/80/443; SSH keys only; auto security updates.
- **Secrets** in env/`.env` (not in code); rotate; never commit. StreetJS supports a vault mode + secret-provider abstraction.
- **Rate limiting + input validation + XSS sanitization** are built in — enable them.
- **Off-box backups** (the one reliability spend you must not skip).
- **Run as non-root** with a `MemoryMax` cap (systemd) so a leak can't take the box down; StreetJS's 0-MB-drift lifecycle (MEASURED) keeps long-run memory flat.

> Honest limits: a single $5 box is **not** highly available — a host failure means
> downtime until restore. The <$50 two-box tier adds failure isolation and off-box
> backups, which is the realistic floor for "production with reliability." True HA
> (multi-region, automatic failover) costs more and is out of budget scope.

---

## Documentation & rollout plan (for maintainers)

1. This guide (overview + tiers) — **done**.
2. Per-tier step-by-step tutorials (provision → deploy → TLS → backup → monitor), one each for <$10 / <$25 / <$50.
3. A "SQLite → PostgreSQL migration" guide (mechanical, same repository pattern).
4. A reproducible `bench/budget` harness so users can size their own VPS (extends `scripts/audit/footprint.mjs`).
5. A reference "budget SaaS" example app + its measured footprint.
6. Track in the [adoption program](/adoption/tutorials-and-examples-program/); publish runnable content, not stubs.
