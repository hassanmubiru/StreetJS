# StreetJS Enterprise Readiness — Framework Comparison (Phase 13)

> Benchmarks StreetJS against mature OSS frameworks across seven dimensions, with
> concrete gaps. Evidence-based against the current repo. Scores 0–100.
> (Distinct from the older `audits/ENTERPRISE-READINESS.md`, Phase 17.)

## Reference set
Next.js, NestJS, Astro, Nuxt, Laravel, Express, Fastify, Vite.

## Dimension scorecard

| Dimension | StreetJS | Reference bar | Score |
|---|---|---|---|
| Repository quality | `packages/` workspace (49 pkgs), `docs/`, `examples/`, `rfcs/`, `benchmarks/`, consolidated `infra/`, lean root (7 `.md`) | NestJS/Nuxt-grade monorepo | **88** |
| Security | Signed plugins + verified anchor, secrets-guard/CI gates, gitleaks+trufflehog, CodeQL, Scorecard, classification + charter | Exceeds most (Vite/Express have far less); near Deno/K8s | **86** |
| Developer experience | CLI scaffolding, `street create`, typed plugins, certification suites, dev compose | Next/Nuxt set the bar (HMR, devtools) | **80** |
| Documentation | `docs/` site + reference, per-plugin README/SECURITY, certification of `docs/*.md` | Laravel/Next-grade depth | **82** |
| Plugin ecosystem | 21 signed official plugins, marketplace data, signing standard, dependency-free design | Exceeds Fastify plugin model on *trust*; smaller catalog than Nest | **84** |
| Release process | Tag-gated, version-lockstep, npm provenance, SBOM, signed manifests, idempotent publish | Matches Vite/Nuxt; provenance ahead of many | **85** |
| Governance | CHARTER, CODEOWNERS, MAINTAINERS, GOVERNANCE, RFCs, classification | Matches Nest/Nuxt; CODEOWNERS single-owner is the gap | **72** |

**Composite: ~82/100 — strong enterprise posture; gaps are governance breadth and a few DX/runtime items.**

## How StreetJS compares (highlights)
- **Ahead of Express/Fastify/Vite** on supply-chain security: those ship no plugin
  signing/provenance trust model; StreetJS signs and CI-verifies every plugin.
- **On par with Next.js/Nuxt/NestJS** on monorepo structure, RFC process, and
  release provenance.
- **Behind Next.js/Laravel** on ecosystem breadth (catalog size), hosted docs
  search/versioning, and a public, fully-staffed security team.

## Gaps (prioritized)

| # | Gap | Reference that does it better | Action |
|---|---|---|---|
| 1 | CODEOWNERS is single-owner (`@hassanmubiru`) — bus factor | Nest/Next use teams | Fill `.github/CODEOWNERS.proposed` team handles |
| 2 | Branch/Push protection are platform settings, unverified-in-repo | All | Apply `security/BRANCH-PROTECTION-REVIEW.md`; export as settings-as-code |
| 3 | History still contains the (distrusted) leaked key | All | Purge (`KEY-ROTATION-RUNBOOK.md` §7) |
| 4 | 9 HTTP plugins lack outbound timeouts; some webhook verifiers missing | Stripe/Twilio SDKs | Dedicated plugin runtime change (`PLUGIN-SECURITY-REPORT.md`) |
| 5 | No standing PGP key; security team is effectively one maintainer | Laravel/Node have teams | Add PGP (placeholder in `SECURITY.md`); grow MAINTAINERS |
| 6 | Docs lack versioned/searchable hosted site parity | Next/Nuxt/Astro | Adopt versioned docs + search (Algolia/Pagefind) |
| 7 | `web/` example apps lack lockfiles → Dependabot can't track | All | Commit `package-lock.json` (cleanup plan) |
| 8 | Generated scaffolds (`app-*`) live at root | Next/Nuxt keep samples in `examples/` | Relocate to `examples/` (cleanup plan) |

## Verdict
StreetJS is **enterprise-adoptable today** for teams comfortable with a young but
security-forward ecosystem. Closing gaps 1–3 (governance + history hygiene) and 4
(plugin resilience) would put it on par with the most mature references on the
dimensions that matter for enterprise procurement (supply-chain integrity,
governance, and disclosure).
