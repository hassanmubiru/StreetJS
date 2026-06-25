# Trust Center Plan — Phase 18, Workstream D (Enterprise Trust Center)

> Planning document only. No source was modified. Every claim below is tagged
> exactly one of **VERIFIED** / **GAP** / **RISK** / **RECOMMENDATION** and links
> to an in-repo evidence path that was confirmed to exist by reading source.
> Repo root audited: `/home/error51/Downloads/street-framework/streetJS`.

---

## Executive Summary

StreetJS already ships the substance of an enterprise Trust Center. The supply-chain
and governance controls a security questionnaire asks for are **real and backed by
files in this repo**, not marketing claims: npm provenance (`--provenance` + a
provenance verification gate), per-release CycloneDX SBOM generation, cosign keyless
signing of GitHub Release assets, OpenSSF Scorecard with `publish_results: true`,
CodeQL, secret scanning (Gitleaks + TruffleHog), dependency review, a DAST pipeline,
Ed25519-signed plugin manifests verified on load against an embedded official key, a
STRIDE threat model, a severity-classified security policy, and a documented
governance/steering-committee model.

The landing page `docs/trust.md` (permalink `/trust/`) already exists and is the
right shell — it presents an evidence-linked table and an enterprise checklist. The
work for Workstream D is **consolidation and evidence-fidelity**, not new controls:

1. **One verifiable claim → one in-repo evidence link.** Today several of the
   strongest controls (cosign signed releases, secret scanning, dependency review,
   DAST, the actual `sbom.json` and SBOM generator, the actual `docs/THREAT-MODEL.md`)
   are **not surfaced** on `/trust/`, while it links instead to indirect "Security
   guide" pages.
2. **Fix one factually-wrong claim.** `/trust/` states "**2 runtime dependencies**
   (`reflect-metadata`, `ws`)". The repo's own evidence contradicts this:
   `packages/core/package.json` declares **three** runtime deps
   (`reflect-metadata`, `ws`, `zod`) and `sbom.json` lists `zod` too. This is the
   single highest-priority RISK — an unbacked claim contradicted by in-repo evidence.

Net: the controls are verified; the Trust Center page needs to be re-pointed at the
real artifacts and corrected so every claim is provable from this repository.

---

## 1. VERIFIED Trust-Evidence Inventory

Each row was confirmed by reading the cited file(s). Status is **VERIFIED** (evidence
file exists and does what the claim says) or **GAP** (absent).

| # | Trust claim / control | Evidence path(s) (in-repo) | What the evidence proves | Status |
|---|----------------------|----------------------------|--------------------------|--------|
| 1 | Security policy & coordinated disclosure | `SECURITY.md` | CVSS v3.1 severity tiers, fix-time targets, private GitHub advisory reporting, scope | **VERIFIED** |
| 2 | Project governance & decision-making | `GOVERNANCE.md` | Roles, RFC lifecycle, Steering Committee, release process, maintainer duties | **VERIFIED** |
| 3 | Code of conduct | `CODE_OF_CONDUCT.md` | Contributor Covenant present (2.5 KB) | **VERIFIED** |
| 4 | Contribution process | `CONTRIBUTING.md` | Contribution bar (impl + tests + docs + examples) | **VERIFIED** |
| 5 | Threat model (STRIDE) | `docs/THREAT-MODEL.md` | STRIDE table across 4 trust boundaries, per-threat control + evidence column, residual risks | **VERIFIED** |
| 6 | OpenSSF Scorecard | `.github/workflows/scorecard.yml` | `ossf/scorecard-action` (SHA-pinned), `publish_results: true`, SARIF to code-scanning, weekly + on-push | **VERIFIED** |
| 7 | CodeQL static analysis | `.github/workflows/codeql.yml` | CodeQL Advanced, `javascript-typescript` + `actions`, push/PR/weekly | **VERIFIED** |
| 8 | npm provenance (core/cli/compat) | `.github/workflows/ci-cd.yml` (`test-and-publish`: `npm publish --provenance`, `id-token: write`, "Verify published provenance attestations" gate) | Packages published from CI with OIDC attestation; release FAILS if attestation missing | **VERIFIED** |
| 9 | npm provenance (plugins) | `.github/workflows/publish-plugins.yml` (`npm publish --provenance`, `id-token: write`) | All `@streetjs/plugin-*` published with provenance | **VERIFIED** |
| 10 | CycloneDX SBOM (committed snapshot) | `sbom.json` | CycloneDX 1.5 BOM, `streetjs@1.0.7` + deps | **VERIFIED** |
| 11 | SBOM generator + per-release SBOM | `scripts/generate-sbom.mjs`; `.github/workflows/ci-cd.yml` ("Generate per-release SBOM" → `sbom-${tag}.json`, uploaded artifact) | SBOM regenerated per release from the actual dep tree and retained | **VERIFIED** |
| 12 | Signed GitHub Release assets (cosign/Sigstore) | `.github/workflows/ci-cd.yml` ("Install cosign", "Pack and sign release tarballs" → `.sig`/`.pem`, "Publish signed GitHub Release") | Keyless cosign signing of tarballs + SBOM on tag pushes (satisfies Scorecard Signed-Releases) | **VERIFIED** |
| 13 | Signed plugins — manifests | `packages/plugin-*/manifest.signed.json` + `packages/plugin-*/manifest.pub` (21 plugins) | Ed25519-signed manifest + public key ship with each plugin | **VERIFIED** |
| 14 | Signed plugins — signing tooling | `packages/plugin-*/scripts/sign.mjs` (and `sign-manifest.mjs`); root script `npm run sign -w packages/<plugin>` | Reproducible signing step; CI signs with stable `STREET_PLUGIN_SIGNING_KEY` | **VERIFIED** |
| 15 | Signed plugins — verify-on-load API | `packages/core/src/index.ts` exports `verifyManifest` / `officialPluginPublicKey`; used in `packages/core/src/platform/plugins/host.ts`, `official-key.ts`, `local-registry.ts`; CI re-verifies packed manifest in `publish-plugins.yml` | Host verifies Ed25519 signature against embedded official key before load | **VERIFIED** |
| 16 | Secret scanning | `.github/workflows/secret-scan.yml` + `.gitleaks.toml` | Gitleaks (config-driven) + TruffleHog (`--only-verified`), fails build on hit | **VERIFIED** |
| 17 | Dependency review + license policy | `.github/workflows/dependency-review.yml` | Fails PRs on high+ advisories; denies AGPL/GPL copyleft licenses | **VERIFIED** |
| 18 | DAST pipeline | `.github/workflows/dast.yml`; `scripts/dast/run-dast.mjs` | Schemathesis + OWASP ZAP against running app, severity gate, retained artifact | **VERIFIED** |
| 19 | Workflow static analysis | `.github/workflows/ci-cd.yml` (`security-lint` job, zizmor) | GitHub Actions workflows scanned for CI antipatterns | **VERIFIED** |
| 20 | Dependency audit / no-placeholder gate | `.github/workflows/ci-cd.yml` (`policy-checks`: `npm audit --audit-level=high`) | High-severity dependency audit in CI | **VERIFIED** |
| 21 | OSI license | `LICENSE` (MIT) | OSI-approved license present | **VERIFIED** |
| 22 | Compliance control mappings | `docs/compliance/control-mappings.md`, `docs/compliance/README.md` | SOC2/HIPAA/GDPR/PCI feature→control mappings with honest "Operator" gaps | **VERIFIED** |
| 23 | Enterprise trust package | `docs/enterprise/{index,architecture-overview,risk-assessment,security-whitepaper,procurement-faq}.md`, `ENTERPRISE-READINESS.md` | Architecture, risk, whitepaper, procurement FAQ, honest readiness | **VERIFIED** |
| 24 | Citation metadata | `CITATION.cff` | Citation file present | **VERIFIED** |
| 25 | Trust Center landing page | `docs/trust.md` (permalink `/trust/`) | Evidence-linked Trust Center already exists | **VERIFIED (with gaps — see §2)** |

**No GAP rows.** Every Workstream-D trust asset enumerated in the brief has a real,
verified evidence file in the repository. The gaps are in *consolidation and
accuracy on `/trust/`*, not in missing controls (see §2–§4).

---

## 2. Assessment of `docs/trust.md` (the `/trust/` page)

**Status: VERIFIED (page exists and is evidence-oriented) — but incomplete and
contains one inaccurate claim.** It is a solid shell but is **not yet authoritative**
because several of the strongest, real controls are absent and one claim is wrong.

What it does well (VERIFIED):
- Already structured as evidence tables ("Supply-chain integrity", "Governance & process").
- Links governance docs (`GOVERNANCE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`) by real path.
- Links Scorecard viewer and CodeQL code-scanning dashboard, and the npm package.
- States the principle: "All claims on this page are evidence-based and link to a verifiable artifact."

What is missing for it to be the authoritative enterprise landing page:
- **GAP — no link to the actual `sbom.json`.** SBOM row points to the "Security guide"
  (`/StreetJS/security/`) which (per `docs/security/index.md`) documents auth/sessions/
  rate-limiting, **not** the SBOM. The real artifacts (`sbom.json`, `scripts/generate-sbom.mjs`,
  per-release SBOM artifact in `ci-cd.yml`) are never linked.
- **GAP — threat model not linked.** The page says "Threat model … (see the Security
  guide)", but the real `docs/THREAT-MODEL.md` exists and is not linked. (Note that
  `docs/THREAT-MODEL.md` front-matter sets `nav_exclude: true` / `noindex: true`, so
  it is invisible unless explicitly linked.)
- **GAP — cosign Signed Releases not mentioned.** The strongest supply-chain signal
  after provenance (keyless cosign signing of release tarballs + SBOM, `ci-cd.yml`)
  is absent from the page.
- **GAP — secret scanning, dependency review, DAST not mentioned.** `secret-scan.yml`,
  `dependency-review.yml`, and `dast.yml` are verified controls but are not surfaced.
- **GAP — provenance evidence is indirect.** The page links npm but not the
  `ci-cd.yml` `--provenance` publish + the "Verify published provenance attestations"
  gate that *enforces* it. The enforcement gate is the strongest evidence and should be cited.
- **GAP — no link to compliance mappings.** `docs/compliance/control-mappings.md`
  (SOC2/HIPAA/GDPR/PCI) is exactly what procurement asks for and is not linked.
- **RISK — see §3 — "2 runtime dependencies" is contradicted by the repo.**

---

## 3. RISKs — claims lacking verifiable in-repo evidence (or contradicted by it)

| RISK | Where | Evidence conflict | Recommended action |
|------|-------|-------------------|--------------------|
| **R1 — "2 runtime dependencies (`reflect-metadata`, `ws`)"** | `docs/trust.md`, Supply-chain table | `packages/core/package.json` declares **3** runtime deps: `reflect-metadata`, `ws`, **`zod`**; `sbom.json` also lists `zod@4.4.3`. The claim is factually wrong and self-contradicted by the repo's own SBOM. | Correct to "**3 runtime dependencies** (`reflect-metadata`, `ws`, `zod`)" and link `sbom.json` as proof. Highest priority — a wrong, checkable number undermines the whole "evidence-based" promise. |
| **R2 — SBOM claim points to a page without the SBOM** | `docs/trust.md` "CycloneDX SBOM" row → `/StreetJS/security/` | `docs/security/index.md` contains no SBOM content. Claim is real but the *link* does not back it. | Re-point to `sbom.json` + `scripts/generate-sbom.mjs` + the `ci-cd.yml` per-release SBOM step. |
| **R3 — Threat-model claim links nowhere verifiable** | `docs/trust.md` "Threat model" line → "see the Security guide" | The Security guide does not contain the threat model; `docs/THREAT-MODEL.md` (the real one) is `noindex`/`nav_exclude`. | Link `docs/THREAT-MODEL.md` directly. |
| **R4 — "Audit-log primitives (see the SaaS starter)"** | `docs/trust.md` checklist | Audit primitives are verified in `docs/compliance/control-mappings.md` (`AuditWriter`, `AUDIT_LOG_MIGRATION_SQL`); the "SaaS starter" pointer is vague and not a verified path from this page. | Cite the control-mappings audit-logging row (concrete API names) instead of an unnamed starter. |
| **R5 — "every release is produced with provenance"** stated without linking the enforcing gate | `docs/trust.md` intro | True and strongly backed (`ci-cd.yml` provenance gate), but the page links only the npm page, not the gate. An unlinked superlative reads as marketing. | Link the `ci-cd.yml` "Verify published provenance attestations" step. |

No control was asserted in this plan without a verified evidence file. Where the brief
listed an anchor that the page *implies* but does not prove (SBOM link, threat-model
link), it is recorded as a RISK above rather than asserted as present.

---

## 4. `/trust/` Consolidation Plan & Gap Matrix vs Workstream D

### 4.1 Gap matrix (Workstream-D requirement → current state → evidence)

| Workstream-D requirement | Control exists? | On `/trust/` today? | Backing evidence (verified) |
|--------------------------|-----------------|---------------------|------------------------------|
| Security policy consolidated | ✅ VERIFIED | ✅ linked | `SECURITY.md` |
| Governance consolidated | ✅ VERIFIED | ✅ linked | `GOVERNANCE.md` |
| Code of conduct consolidated | ✅ VERIFIED | ✅ linked | `CODE_OF_CONDUCT.md` |
| Threat model consolidated | ✅ VERIFIED | ❌ **GAP** (vague pointer) | `docs/THREAT-MODEL.md` |
| OpenSSF Scorecard | ✅ VERIFIED | ✅ linked (viewer) | `.github/workflows/scorecard.yml` |
| SBOM generation | ✅ VERIFIED | ⚠️ **GAP** (wrong link) | `sbom.json`, `scripts/generate-sbom.mjs`, `ci-cd.yml` |
| npm provenance | ✅ VERIFIED | ⚠️ partial (npm only) | `ci-cd.yml`, `publish-plugins.yml` |
| CodeQL | ✅ VERIFIED | ✅ linked | `.github/workflows/codeql.yml` |
| Signed plugins | ✅ VERIFIED | ✅ linked (plugin system) | `manifest.signed.json`/`.pub`, `sign.mjs`, `verifyManifest` |
| Signed releases (cosign) | ✅ VERIFIED | ❌ **GAP** | `ci-cd.yml` cosign steps |
| Secret scanning | ✅ VERIFIED | ❌ **GAP** | `.github/workflows/secret-scan.yml` |
| Dependency review | ✅ VERIFIED | ❌ **GAP** | `.github/workflows/dependency-review.yml` |
| DAST | ✅ VERIFIED | ❌ **GAP** | `.github/workflows/dast.yml` |
| Compliance control mappings | ✅ VERIFIED | ❌ **GAP** | `docs/compliance/control-mappings.md` |
| Dependency-count claim accurate | ❌ **RISK** | ⚠️ wrong on page | `packages/core/package.json`, `sbom.json` |

### 4.2 Consolidation principle (mandatory)

Every line on `/trust/` must resolve to a verifiable artifact **in this repository**
(a workflow file, `sbom.json`, a sign script, a doc) — not to an external dashboard
alone. External links (Scorecard viewer, npm) stay as *secondary* proof but must be
paired with the in-repo source that produces them.

---

## 5. Prioritized RECOMMENDATIONs

Each is tagged **RECOMMENDATION** with Implementation Order, ROI ranking, Adoption
Impact, and Maintenance Cost. All are documentation-only edits to `docs/trust.md`
(and small additions); none touch core framework source.

### RECOMMENDATION 1 — Fix the runtime-dependency count (R1)
- **What:** Change "2 runtime dependencies (`reflect-metadata`, `ws`)" → "3 runtime
  dependencies (`reflect-metadata`, `ws`, `zod`)" and link `sbom.json`.
- **Implementation Order:** 1 (do first).
- **ROI ranking:** Highest — a single wrong, trivially-checkable number discredits an
  "evidence-based" page; near-zero effort.
- **Adoption Impact:** High — security reviewers cross-check dependency claims against
  `package.json`; a mismatch is a credibility red flag.
- **Maintenance Cost:** Low — pair the number with `sbom.json`; revisit only on dep changes.

### RECOMMENDATION 2 — Re-point SBOM and threat-model links to real artifacts (R2, R3)
- **What:** SBOM row → `sbom.json` + `scripts/generate-sbom.mjs` + the `ci-cd.yml`
  per-release SBOM step. Threat-model line → `docs/THREAT-MODEL.md`.
- **Implementation Order:** 2.
- **ROI ranking:** High — converts two existing-but-unlinked controls into provable claims.
- **Adoption Impact:** High — SBOM and threat model are standard questionnaire line items.
- **Maintenance Cost:** Low — stable paths.

### RECOMMENDATION 3 — Surface the missing supply-chain controls
- **What:** Add `/trust/` rows for cosign Signed Releases (`ci-cd.yml`), secret scanning
  (`secret-scan.yml`), dependency review (`dependency-review.yml`), and DAST (`dast.yml`),
  each linking its workflow file.
- **Implementation Order:** 3.
- **ROI ranking:** High — these are real, strong controls already running; surfacing them
  is pure upside.
- **Adoption Impact:** High — broadens the verifiable control set enterprises score against.
- **Maintenance Cost:** Low — workflow files are stable; update only if renamed.

### RECOMMENDATION 4 — Cite the provenance *enforcement* gate, not just npm (R5)
- **What:** Add the `ci-cd.yml` "Verify published provenance attestations" step (and
  the plugin verify-manifest step) as the in-repo proof behind the provenance claim.
- **Implementation Order:** 4.
- **ROI ranking:** Medium-High — turns a marketing-sounding superlative into an enforced, auditable control.
- **Adoption Impact:** Medium-High — "the build fails without provenance" is a stronger statement than "we publish to npm".
- **Maintenance Cost:** Low.

### RECOMMENDATION 5 — Link compliance control mappings from `/trust/`
- **What:** Add a "Compliance" row linking `docs/compliance/control-mappings.md`
  (SOC2/HIPAA/GDPR/PCI), preserving its honest "Operator" caveats.
- **Implementation Order:** 5.
- **ROI ranking:** Medium-High — directly answers procurement/questionnaire needs.
- **Adoption Impact:** High for regulated buyers; the honesty (mappings, not attestations) builds trust.
- **Maintenance Cost:** Low-Medium — review when controls/regulations change.

### RECOMMENDATION 6 — Add an evidence-provenance footer / link-check guard
- **What:** Add a short "How to verify" note on `/trust/` (clone repo → open cited file)
  and a CI link-check so a future broken/removed evidence path fails the docs build,
  keeping the "every claim links to a verifiable artifact" promise true over time.
- **Implementation Order:** 6 (last).
- **ROI ranking:** Medium — prevents silent evidence rot; modest setup.
- **Adoption Impact:** Medium — signals rigor; mostly protects future credibility.
- **Maintenance Cost:** Medium — a link-checker needs occasional upkeep.

### Guardrail for all recommendations
Do **not** add any claim to `/trust/` whose evidence file does not already exist in the
repo. If a desired claim has no backing file, either add the evidence first or omit the
claim (per the no-marketing-without-evidence principle). Net change here is **subtractive
on one claim (R1) and additive-with-evidence** on the rest.

---

## Appendix — Verification method

All findings were confirmed by reading source: root governance/trust files; the security
workflows (`scorecard.yml`, `codeql.yml`, `secret-scan.yml`, `dependency-review.yml`,
`dast.yml`); both publish paths (`ci-cd.yml` `test-and-publish` job, `publish-plugins.yml`);
`sbom.json`; `scripts/generate-sbom.mjs` (invocation confirmed in `ci-cd.yml`); plugin
signing artifacts (`manifest.signed.json`/`manifest.pub` across 21 plugins) and `sign.mjs`
scripts; core exports of `verifyManifest`/`officialPluginPublicKey`
(`packages/core/src/index.ts` + usage in the plugin host); `packages/core/package.json`
dependencies; and the docs set (`docs/trust.md`, `docs/THREAT-MODEL.md`,
`docs/security/index.md`, `docs/compliance/control-mappings.md`, `docs/enterprise/index.md`).
No source files were modified.
