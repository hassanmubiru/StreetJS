# StreetJS Phase 19 — Demo Infrastructure Plan

> How to host live, clickable demos for every major capability — cheaply, safely, and maintainably by a
> single maintainer. This plan is the direct enabler of the Phase-19 success metric:
> *"a developer can see a live application for every major capability within five minutes."*
>
> Grounded in VERIFIED repo facts: all demos already run (`examples/reference-apps/*` with `server.mjs` +
> `smoke-test.mjs`), expose `GET /health/live` + `/health/ready`, and ship real `deploy/` artifacts
> (Docker, Helm/K8s, Cloud Run, Cloudflare, ECS, Vercel, Lambda/Azure) plus `scripts/deploy/smoke-test.sh`.
> Nothing here requires core changes or fabricated content.

---

## 1. Design principles (solo-maintainer, supply-chain-honest)

1. **Self-hosting first, consistent with the brand.** StreetJS's whole pitch is "self-host a full backend cheaply." The demos should *demonstrate that thesis* — run them on one small VPS (the budget-guide stack), not a sprawl of managed services.
2. **Few demos, fully automated.** Bus factor = 1. Prefer 5–6 auto-reset, container-managed demos over many hand-tended ones.
3. **Reproducible from the repo.** Every demo boots from the same images/artifacts CI already builds; no snowflake servers.
4. **Safe by construction.** No real money (MarzPay sandbox only), no real PII, no unbounded AI spend, auth-gated where needed, rate-limited everywhere, reset on a schedule.
5. **Honest surfacing.** A "Live demo" link only appears after the instance is up and the shared smoke test passes — wired so the badge is data-driven and self-correcting.

---

## 2. Recommended topology

**Primary: one VPS + Caddy + Docker Compose (the "dogfood" option).**

```
                 demo.streetjs.dev  (Caddy: auto-TLS, reverse proxy, per-app subpaths/subdomains)
                          │
   ┌──────────────┬───────┴────────┬───────────────┬───────────────┬───────────────┐
   ▼              ▼                ▼               ▼               ▼               ▼
 saas.*        billing.*         htmx.*          chat.*          ai.*           crm.*  (when built)
 (Docker)      (Docker,          (Docker,        (Docker,        (Docker,       (Docker)
  RBAC/orgs     MarzPay           HTMX+SSE        WS-enabled)     demo-safe       SaaS base
  + audit)      SANDBOX)          dashboard)                      model mode)
   │              │                │               │               │
   └──────────────┴── each: /health/live + /health/ready, MemoryMax cap, restart=always ──┘
                          │
                  Postgres (one container, one DB per demo) + nightly reset cron
```

- **Why a VPS:** matches the budget thesis (MEASURED ~64 MB idle/app), supports **WebSockets** (required for Realtime Chat — rules out plain serverless), and one box hosts all demos for ~$5–$12/mo.
- **Caddy** gives free auto-TLS and clean per-demo subdomains.
- **Docker Compose** uses the images CI already builds; `restart: always` + `MemoryMax` keeps a leak from taking the box down.

**Alternative per-demo (if a VPS is undesirable):**
| Demo | Best managed target | Note |
|---|---|---|
| SaaS, CRM, MarzPay, HTMX | **Google Cloud Run** (`deploy/cloud-run/service.yaml` exists) | scale-to-zero; fine for HTTP+SSE |
| Realtime Chat, Multiplayer | **Fly.io / a VPS** | needs persistent **WebSocket** connections (Cloud Run OK for WS but min-instances ≥1 to avoid cold drops) |
| AI Assistant | Cloud Run or VPS | gate behind demo-safe model mode |

> Keep ONE topology to limit maintenance. Recommendation: **single VPS + Compose**, with Cloud Run as the documented fallback.

---

## 3. Per-demo hosting requirements

| Demo | Host class | Stateful? | Secrets needed | Special constraint |
|---|---|---|---|---|
| SaaS | HTTP | Postgres | `JWT_SECRET`, `SESSION_KEY`, `KEK`, `PG_*`, `ALLOWED_ORIGINS` | seed a read-only demo org + login |
| MarzPay Billing | HTTP | Postgres | above + `MARZPAY_*` **sandbox** | **never** real keys; webhook re-verify only |
| HTMX Dashboard | HTTP + SSE | light | above | SSE keep-alive through Caddy |
| Realtime Chat | **WebSocket** | in-mem/Postgres | above | host MUST allow long-lived WS; WS idle timeout tuned |
| AI Assistant | HTTP | vector store | above + model key **or** fixture mode | **demo-safe model mode** (budget-capped or canned) |
| CRM (when built) | HTTP | Postgres | as SaaS | reuses SaaS plumbing |

**Production boot guard (VERIFIED):** in `NODE_ENV=production` the app refuses to start without `ALLOWED_ORIGINS` (no accidental wildcard CORS) and requires `JWT_SECRET` ≥32, `SESSION_KEY` 64-hex, `KEK`, `PG_*`. Demos must supply all of these via the host's secret store.

---

## 4. Safety controls (mandatory for public demos)

- **Reset on a schedule.** A cron (`docker compose restart` + DB reseed) every N hours wipes demo mutations and any abuse. Ship a `demos/reset.sh` + seed scripts.
- **Read-mostly demo accounts.** Pre-seed a demo org/user; allow create/edit but reset frequently. Display a "demo resets hourly" banner.
- **Rate limiting on.** StreetJS's built-in `RateLimiter` per-IP; Caddy-level limits as a second layer.
- **MarzPay = sandbox only.** Use MarzPay's sandbox/test credentials; the demo persists subscription *records* but moves **no real money**. Webhook controller does server-side re-verification (the verified pattern).
- **AI = demo-safe mode.** Add a `DEMO_MODE=1` toggle that either (a) uses a hard token/request budget cap behind strict rate limiting, or (b) serves canned, deterministic answers from fixtures so the public instance can never overspend.
- **No PII.** Seed data only; auth demo uses throwaway accounts; nothing collects real personal data.
- **Resource caps.** `MemoryMax` per container (systemd/Compose), so one demo can't starve the box.

---

## 5. Surfacing live demos (data-driven, self-correcting)

Mirror the plugin-marketplace pattern so the showcase never drifts:

1. Add **`docs/_data/demos.json`** — one record per live demo:
   ```jsonc
   { "slug": "saas", "title": "SaaS", "url": "https://saas.demo.streetjs.dev",
     "source": "examples/reference-apps/saas", "capability": "Auth · RBAC · Multi-tenant",
     "status": "live", "resetsEvery": "1h", "sandbox": true }
   ```
2. A small generator step (extend the existing `pages.yml` build) validates each `url`'s `/health/ready` at build time and only emits a **"Live demo"** badge for records that respond `live`. Down demos degrade to "source only" automatically — no false promises.
3. Showcase cards gain a **Live · Source · Deploy · Docs** quadrant sourced from `demos.json`.

---

## 6. CI / keep-alive integration

- **Deploy on tag.** A `demos-deploy.yml` workflow (manual dispatch + on a `demos-v*` tag) SSHes to the VPS (or `gcloud run deploy`) and runs `scripts/deploy/smoke-test.sh BASE_URL=…` against each demo; fails the deploy if any `/health/ready` ≠ 200. Pin all actions to SHAs (repo policy).
- **Uptime probe.** A scheduled workflow hits each demo's `/health/live` and opens an issue (or flips `demos.json` status) if one is down — so the site never advertises a dead demo.
- **Reuse existing verification.** `scripts/verify-reference-apps.sh` already proves the apps boot + smoke-pass in CI before they ever reach the demo host.

---

## 7. Cost & maintenance

| Option | Approx. cost/mo | Maintenance | Notes |
|---|---|---|---|
| 1 VPS (Hetzner CPX/CX, 4–8 GB) + Caddy + Compose | **$5–$12** | low (auto-reset, restart=always) | hosts all demos; on-brand; supports WS |
| Cloud Run (scale-to-zero) per HTTP demo | ~$0–$5 idle | low | cold starts; WS needs min-instances ≥1 |
| Fly.io (WS demos) | ~$0–$5 | low | good for chat/multiplayer |

**Recommendation:** single VPS for all demos (cheapest, on-brand, WS-capable). Document the Cloud Run/Fly fallback for contributors who want to spin up their own.

---

## 8. Rollout sequence

1. **Provision** the VPS + Caddy + Compose; deploy **SaaS** and **Realtime Chat** first (strongest, lowest-risk). Smoke-test.
2. Add **`demos.json`** + the build-time health gate + "Live demo" badges.
3. Deploy **MarzPay (sandbox)**, **HTMX dashboard**, **AI (demo-safe)**.
4. Wire the **uptime probe** + **deploy-on-tag** workflows.
5. Add **CRM** once built (`SHOWCASE-ROADMAP.md` item 9).

**Definition of done for the success metric:** from the homepage, a "Live demo" badge reaches a working, smoke-passing instance for SaaS, MarzPay, HTMX, Realtime, and AI (CRM when built) — each in one click, within five minutes.

---

## 9. Open decisions (need a human call)

- **Domain:** confirm `demo.streetjs.dev` (or subpaths under the existing Pages domain via a proxy). Requires DNS the maintainer controls.
- **Host choice:** single VPS (recommended) vs. Cloud Run/Fly per demo.
- **AI demo mode:** budget-capped real model vs. canned fixtures (fixtures = zero cost, fully safe; real = more impressive).
- **Secrets provisioning:** which secret store on the chosen host (VPS env files vs. Cloud Run secrets).

These are infrastructure/credential/DNS actions only the maintainer can perform — this plan makes every one of them turnkey, but none can be executed from the repository alone.
