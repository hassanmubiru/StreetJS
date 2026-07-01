---
layout: default
title: Support Matrix
parent: Enterprise
nav_order: 5
permalink: /enterprise/support-matrix/
description: "StreetJS version-support, platform, runtime, and backport matrix for enterprise adopters, procurement, and security reviewers."
---

# StreetJS Support & Platform Matrix

> **Purpose:** the authoritative version-support, platform, and backport matrix for
> enterprise adopters. **Audience:** procurement, platform/SRE teams, security reviewers.
> **Status:** Active. **Last Updated:** 2026-06.
> **Related:** [`lts-policy.md`](../lts-policy.md), [`compatibility.md`](../compatibility.md),
> [`../../governance/RELEASE-POLICY.md`](../../governance/RELEASE-POLICY.md),
> [`procurement-faq.md`](./procurement-faq.md), [`../../SECURITY.md`](../../SECURITY.md).

> **Evidence basis (VERIFIED from repo):** `packages/core` version **1.0.25**;
> `engines` = **Node `>=20.0.0`**, **npm `>=9.0.0`**. Security policy supports the
> latest published **`1.0.x`** line. Dates below are governed by the LTS policy and
> are set by maintainers at each release — cells marked *(per LTS policy)* are
> intentionally not hard-coded here to avoid stale/fabricated dates.

## Version support matrix
| Line | Status | Security fixes | Support window | Notes |
|---|---|---|---|---|
| `1.0.x` | **Active / supported** | ✅ Critical/High per `SECURITY.md` SLAs | *(per LTS policy)* | current published line (`@streetjs/core@1.0.25`) |
| `< 1.0` | Unsupported | ❌ | ended | pre-stable |
| next major (`2.x`) | Planned | n/a | n/a | will follow SemVer + migration guide + codemods |

- **SemVer guarantee:** MAJOR = breaking, MINOR = compatible features, PATCH = fixes
  (`governance/RELEASE-POLICY.md`). No breaking change without a MAJOR bump + migration guide.
- **LTS designation, exact EOL dates, and overlap windows:** governed by
  [`lts-policy.md`](../lts-policy.md) (single source of truth for dates).

## Backport policy
| Severity | Backported to | Timeline |
|---|---|---|
| Critical (CVSS 9.0–10) | supported `1.0.x` | ≤ 7 days (`SECURITY.md`) |
| High (7.0–8.9) | supported `1.0.x` | ≤ 14 days |
| Medium (4.0–6.9) | supported `1.0.x` (best-effort) | ≤ 30 days / next release |
| Low | next scheduled release | best-effort |
- Security fixes ship as PATCH on the supported line with a GitHub Security Advisory + CVE
  (`SECURITY.md`). Feature backports to older lines are **not** guaranteed.

## Runtime & platform support (VERIFIED from `engines`)
| Platform | Support |
|---|---|
| Node.js | **≥ 20.0.0** (LTS lines); ≥ 22 recommended |
| npm | **≥ 9.0.0** |
| OS | Linux (primary, CI-tested), macOS, Windows |
| Databases | PostgreSQL, MySQL (CI-tested wire drivers); MongoDB via plugin |
| Containers | distroless Node 22 image (`infra/docker/Dockerfile`, digest-pinned) |
| Cloud targets | AWS ECS, Google Cloud Run, Cloudflare Workers, Vercel (`infra/examples/*`), Kubernetes + Helm (`infra/{kubernetes,helm}`) |

> Node/DB version testing is exercised in CI (`ci-cd.yml` Node 22/24 matrix; PG/MySQL
> service containers). Specific tested patch versions: see CI configuration.

## Compatibility & upgrades
- Compatibility policy: [`compatibility.md`](../compatibility.md).
- Migration tooling: `docs/migration.md` + framework-specific guides
  (Fastify/Express/NestJS) + **codemods** (`npm run verify:codemods`).
- Plugin compatibility: each `@streetjs/plugin-*` versions independently under SemVer;
  signed manifests verified against the official key in CI.

## Support channels
| Tier | Channel |
|---|---|
| Security (private) | GitHub private vulnerability reporting (`SECURITY.md`) |
| Community | GitHub Issues / Discussions, contributor guides |
| Commercial support | *Not currently offered* (community-maintained). UNVERIFIED — update if a commercial entity is established. |

## Maintainer-set fields (fill at release time)
*(Left explicit rather than fabricated.)*
- LTS start/EOL dates per line → maintained in `lts-policy.md`.
- Commercial support / SLA tiers → only if a commercial offering exists.
- Certified cloud-provider versions → from `infra/examples/*` validation runs.
