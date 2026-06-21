# Enterprise Readiness — StreetJS Phase 17 (Workstream H)

> Tags: **VERIFIED** · **GAP** · **RECOMMENDATION**.

## Audit — VERIFIED / GAP

| Dimension | State |
|---|---|
| `SECURITY.md` (policy + disclosure) | VERIFIED (root) |
| `GOVERNANCE.md` | VERIFIED (root) |
| RFC process | VERIFIED (`rfcs/`) |
| Release process | VERIFIED — `v*.*.*` tag → CI "Test & Publish" with **provenance attestations** + per-release **SBOM**; tag-version lockstep gate (`scripts/check-tag-version.mjs`) |
| Supply-chain signals | VERIFIED — CycloneDX SBOM, npm provenance, CodeQL, OpenSSF Scorecard, signed plugin manifests |
| LTS policy | VERIFIED — `docs/lts-policy.md` exists |
| Certification suites | VERIFIED — `street certify`, runtime/security/perf/observability certifications |
| Support process / matrix | GAP — no published support tiers/SLAs |
| Upgrade guarantees | partial — `street upgrade` + codemods (VERIFIED); no written compatibility/deprecation policy |
| Compatibility policy (SemVer commitments) | GAP — implied, not documented |
| Multi-tenant reference | GAP — no enterprise multi-tenant showcase (see Workstream C) |

**Finding:** StreetJS already exceeds most young frameworks on supply-chain and
release rigor (provenance + SBOM + OpenSSF + signed plugins). The enterprise gaps
are **policy documents and guarantees**, not engineering.

## Readiness by segment

| Segment | Readiness | Blockers |
|---|---|---|
| **Startup** | High — VERIFIED | Zero-config boot, sqlite default, cheap self-host; ready today |
| **Agency** | Medium-High | Needs starters (Workstream B) + showcase breadth for client delivery |
| **Enterprise** | Medium | Needs: published support matrix, SemVer/compat policy, LTS commitments table, multi-tenant reference, security questionnaire pack |

## RECOMMENDATIONS

1. **LTS policy table** — formalize `docs/lts-policy.md` into a versioned table
   (Active / Maintenance / EOL dates per major) with a public calendar.
2. **Support matrix** — publish channels + response targets (community vs
   commercial), even if commercial is "contact us" initially.
3. **Compatibility & deprecation policy** — document SemVer commitments, the
   deprecation window, and that `street upgrade` codemods ship for breaking
   changes (the tooling already exists — VERIFIED).
4. **Upgrade guarantees** — promise codemod coverage for every breaking major;
   tie to the existing `upgrade` command + `docs/upgrade.md`.
5. **Enterprise trust pack** — one page consolidating SECURITY, THREAT-MODEL,
   SBOM, provenance, OpenSSF, plugin signing, governance, RFC (most artifacts
   exist; this is assembly + a security-questionnaire/whitepaper).
6. **Multi-tenant reference app** (Workstream C advanced tier) as the concrete
   enterprise proof point.

**RECOMMENDATION (highest ROI):** ship the **enterprise trust hub page** — it
packages already-VERIFIED artifacts into the single asset enterprise buyers ask
for, with near-zero engineering cost.
