# StreetJS Phase 18 — Ecosystem Visibility & Marketplace Expansion — Master Audit

> **Type:** Audit + synthesis (planning only). **No framework/core source was modified** by this deliverable.
> **Objective (per brief):** make existing capabilities *visible, searchable, and adoptable* — not build new framework features.
> **Method:** every finding was verified from source in this repository before being recorded. Findings are tagged exactly one of **VERIFIED** (confirmed by reading source), **GAP** (absent / not implemented), **RISK** (present but a correctness/trust hazard), **RECOMMENDATION** (proposed, non-core change).
> **Principles enforced:** dependency-light · frontend-agnostic · signed plugins · TypeScript-first · no marketing claims without evidence · no core framework changes.

This master audit consolidates seven workstreams. The detailed, per-workstream plans are separate deliverables and are the source of the granular findings summarized here:

| Workstream | Deliverable | Status |
|---|---|---|
| A — Official Plugin Marketplace | `PLUGIN-MARKETPLACE-PLAN.md` | ✅ written |
| B — Starter Catalog | `STARTER-CATALOG-PLAN.md` | ✅ written |
| C — Showcase Gallery | `SHOWCASE-GALLERY-PLAN.md` | ✅ written |
| D — Enterprise Trust Center | `TRUST-CENTER-PLAN.md` | ✅ written |
| E — Ecosystem Homepage Refresh | *(covered in this master audit — §5.E)* | ✅ assessed |
| F — Content Engine | `CONTENT-ROADMAP.md` | ✅ written |
| G — Community Growth | `COMMUNITY-GROWTH-PLAN.md` | ✅ written |

---

## 1. Executive Summary

**StreetJS has already built most of Phase 18.** This is the dominant, repeatedly-verified finding. A prior Phase-18 effort (`PHASE-18-EXECUTION-PLAN.md`) shipped a real, auto-generated plugin marketplace, a `--starter` CLI catalog, a `/trust/` center, a `/starters/` page, a `/showcase/` gallery, and a discovery-oriented homepage. The framework is mature; the ecosystem *surfaces* largely exist.

Consequently, the next bottleneck is **not** "build the marketplace/starters/trust/showcase" — those exist (**VERIFIED**). It is **accuracy, evidence-fidelity, and presentation maturity** of what already exists. The highest-value Phase-18 work is now corrective and curative:

1. **Truthfulness of trust signals** — the marketplace hardcodes "Signed / Dependency-free / npm provenance" on every plugin detail page regardless of the package's real state; `@streetjs/plugin-htmx` is **listed and shown as signed but has no committed `manifest.signed.json`** (RISK).
2. **A cross-cutting factual error** — multiple surfaces claim **"2 runtime dependencies (`reflect-metadata`, `ws`)"**, but `packages/core/package.json` declares **three** (`reflect-metadata`, `ws`, **`zod`**) and `sbom.json` lists `zod@4.4.3`. A wrong, trivially-checkable number on evidence-based pages is the single most damaging issue found (RISK).
3. **Presentation gaps** — starters/showcase lack screenshots, architecture diagrams, per-entry docs links, difficulty tiers, and a learning path; the marketplace omits maintainer info, a visible GitHub link, and a numeric dependency count.
4. **Doc drift** — several docs and the prior execution log carry stale counts/claims (e.g. "19 plugins / 8 categories" vs the real **20 / 9**; `STARTERS-ROADMAP.md` still says "there is no `--starter` flag"); community "done" claims (Discussions enabled/seeded) are GitHub runtime state and **not verifiable from source**.

Net: Phase 18 should be executed as a **visibility-and-accuracy pass**, not a build-out. Almost every recommendation across all seven workstreams is **docs/generator/metadata-only** — no core framework changes — consistent with the brief.

**Verified ecosystem scale (anchors for the whole audit):**
- **~30 `plugin-*` packages**; the marketplace lists **20** and hides **1** (`plugin-marzpay`, `streetjs.unlisted: true`). 9 categories. (`docs/_data/plugins.json`, `scripts/gen-plugins-data.mjs`.)
- **6 real `--starter` templates** (`app`, `saas`, `ecommerce`, `realtime-chat`, `dating-app`, `ai`) + 4 aliases + 4 frontends (`none/react/next/htmx`) + 4 `--with-*` flags. (`packages/cli/src/commands/create.ts`.)
- **6 runnable showcase apps** (`examples/01-rest-api` … `06-multiplayer`) all backed by real code, plus a hidden, CI-tested `examples/reference-apps/*` tier.
- **Full enterprise control set is real**: npm provenance (enforced by a CI gate), CycloneDX SBOM + generator, cosign signed releases, OpenSSF Scorecard, CodeQL, secret scanning, dependency review, DAST, Ed25519-signed plugin manifests verified on load.
- **Complete governance/community paper-trail**: `GOVERNANCE.md` (RFC lifecycle + Steering Committee), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `rfcs/` (used — two accepted RFCs), contributor ladder, plugin certification gradient, issue/mentored-task templates, `labels.yml`.

---

## 2. Methodology & Verification Posture

- Enumerated `packages/` and read every `packages/plugin-*/package.json`; checked each for an on-disk `manifest.signed.json`.
- Read the marketplace generator (`scripts/gen-plugins-data.mjs`), generated data (`docs/_data/plugins.json`), and the marketplace page (`docs/plugins/marketplace.md`).
- Read the CLI scaffolder (`packages/cli/src/commands/create.ts`) for the real `TEMPLATES`/`STARTER_ALIASES`/`FRONTENDS`/`DATABASES`/`--with-*` surface.
- Read the homepage (`docs/index.md`), `docs/starters.md`, `docs/showcase.md`, `docs/trust.md`, the `examples/` tree, the `.github/workflows/` security pipelines, root governance/trust files, `rfcs/`, and `.github/` process assets.
- Cross-checked dependency claims against `packages/core/package.json` and `sbom.json`.

**Verification rule applied throughout:** anything that lives only in GitHub *runtime state* (Discussions enabled, issues seeded, Sponsors button rendering, live Scorecard score) is recorded as **"claimed, not source-verifiable"** rather than VERIFIED, per the no-claims-without-evidence principle.

---

## 3. Cross-Cutting Findings (apply across multiple workstreams)

### X1 — RISK (highest): the "2 runtime dependencies" claim is factually wrong
- **Evidence:** `packages/core/package.json` declares **3** runtime deps — `reflect-metadata`, `ws`, **`zod`**; `sbom.json` lists `zod@4.4.3`.
- **Where it leaks:** `docs/trust.md` ("2 runtime dependencies"), the blog post `docs/blog/why-2-dependencies.md`, and any content/positioning that repeats "2 deps" (the Content roadmap and the prior execution plan both lean on it).
- **Impact:** a single wrong, checkable number on *evidence-based* pages undermines the whole "no marketing claims without evidence" posture — security reviewers cross-check `package.json`.
- **RECOMMENDATION:** correct every surface to **"3 runtime dependencies (`reflect-metadata`, `ws`, `zod`)"** and link `sbom.json` as proof; reframe the blog/positioning around "dependency-light" (still true and defensible) rather than a now-stale count. Do **not** publish further "2 deps" content until corrected.

### X2 — RISK: hardcoded trust badges (signed / dependency-free / provenance)
- **Evidence:** `gen-plugins-data.mjs` prints "✅ Signed manifest (Ed25519)", "Dependency-free", "npm provenance" on every detail page unconditionally; `plugin-htmx` is listed and shown as signed but has **no `manifest.signed.json`** on disk.
- **Impact:** a marketplace whose trust badges are not derived from real artifacts can show a false trust signal — directly against the "signed plugins / no claims without evidence" principle.
- **RECOMMENDATION (Workstream A REC-1):** derive `signed`/`depCount` from on-disk artifacts at generation time; either sign+commit `plugin-htmx`'s manifest or stop labeling it signed.

### X3 — RISK: stale counts/claims in prior Phase-18 artifacts
- **Evidence:** `PHASE-18-EXECUTION-PLAN.md` execution log says "8 category pages + 19 detail pages" / "19 plugins, 8 categories"; current generated state is **20 plugins / 9 categories**. `PLUGIN-MARKETPLACE.md` carries the same stale counts. `STARTERS-ROADMAP.md` still asserts "there is **no `--starter` flag**" (now false). `docs/cli-reference.md`/`docs/roadmap.md` omit the real `htmx` frontend and `ai` starter.
- **RECOMMENDATION:** mark the prior execution plan / roadmaps as **superseded**, regenerate counts from `plugins.json`, and unify CLI flag docs to a single source of truth.

### X4 — RISK: "unlisted MarzPay" vs "feature MarzPay" tension (affects A + E)
- **Evidence:** the brief asks the homepage to feature MarzPay as a flagship plugin, but `packages/plugin-marzpay/package.json` sets `streetjs.unlisted: true`, so the generator deliberately **hides** it from the marketplace (verified: absent from `plugins.json`).
- **Impact:** featuring an intentionally-unlisted plugin on the homepage would contradict the marketplace's own exclusion and confuse users who can't find it in `/plugins/`.
- **RECOMMENDATION:** either (a) keep MarzPay out of homepage "featured plugins" until it is published/listed, or (b) if it is ready to publish, flip `unlisted` and let the generator list it — then feature it. Do **not** feature a plugin the marketplace hides.

### X5 — RISK: activity claims that are GitHub runtime state, not source
- **Evidence:** `COMMUNITY-ROADMAP.md` claims Discussions enabled + seeded (#66–69) and 20 curated good-first-issues; these cannot be confirmed from repository source.
- **RECOMMENDATION:** label such items "claimed, not source-verifiable" until observable; never present them as evidence-backed.

### X6 — RISK (structural): bus factor = 1
- **Evidence:** sole `CODEOWNER` `@hassanmubiru`; no `MAINTAINERS` file (`GOVERNANCE.md` says "to be populated"); Steering Committee needs ≥3 seats.
- **Impact:** every community/mentorship/SLA program in the brief assumes recurring maintainer capacity that does not exist. Over-committing damages trust more than not offering a program.
- **RECOMMENDATION:** size all community programs to be solo-maintainer-survivable (batched, pausable, automation-first); add a `MAINTAINERS` file and an honest "governance activates at N≥3" note.

---

## 4. Consolidated Status by Workstream (VERIFIED / GAP / RISK)

| WS | What's VERIFIED (already built) | Top GAPs | Top RISKs |
|---|---|---|---|
| **A — Marketplace** | Auto-generated from `packages/plugin-*` (single source of truth); 20 listed / 1 hidden; search + category filter + detail pages + install + npm links + version (detail) + static compatibility; unlisted exclusion works | Maintainer info, visible GitHub link, numeric dependency count; requested categories Realtime/Search/Observability/Integrations have no mapping/plugins; version not on hub card | Hardcoded trust badges; htmx shown signed but unsigned (X2); static compat can drift |
| **B — Starters** | Real `--starter` system: 6 templates + 4 aliases + 4 frontends + 4 `--with-*` flags; `saas`/`ai`/`realtime` all exist; sample scaffolds `app-*/` exist | `/starters/` has no screenshots, architecture diagrams, per-starter docs links, or deep feature lists; `ai`/`dating-app` are thin (no migration/README) | `docs/starters.md` mis-attributes SaaS to `@streetjs/admin` (false dependency); `--starter htmx` is a dead-end (htmx is a `--frontend`); stale roadmap (X3) |
| **C — Showcase** | 6 showcase cards all backed by real runnable apps (`examples/01-06`); source links valid; illustrative SVG covers exist; a richer CI-tested `reference-apps/*` tier exists | No real screenshots, no architecture diagrams, no difficulty tiers, no learning path, no standardized stack breakdowns | 4/6 cards link to generic docs; Realtime Chat doc describes a *different* impl than its backing app (credibility) |
| **D — Trust Center** | Entire control set is real & backed: provenance (enforced gate), SBOM + generator, cosign signed releases, Scorecard, CodeQL, secret scan, dependency review, DAST, signed plugin manifests verified on load; `docs/trust.md` exists | `/trust/` doesn't surface cosign/secret-scan/dependency-review/DAST/SBOM file/threat-model/compliance mappings | **"2 runtime dependencies" is wrong (X1)**; SBOM/threat-model rows link to pages that don't contain them |
| **E — Homepage** | Discovery homepage already exists with Hero + code + "Why" grid + Showcase + **Ecosystem grid surfacing Plugins(→marketplace)/Starters/Trust/Security/Community/Examples/GitHub** + CTA | No *featured-plugins* section (cards are generic, not HTMX/OpenAI/Redis/Kafka/Stripe); showcase cards link to `/showcase/` generically | Featuring MarzPay would contradict its unlisted state (X4); "20+ plugins" is accurate today but count strings drift (X3) |
| **F — Content** | 3 live blog posts; native-driver/SaaS/HTMX/multi-tenant/MarzPay/realtime/dependency-light are all VERIFIED strengths with evidence; large backlog exists | No named customer case studies (`docs/case-studies/` is templates only) | Performance numbers must stay MEASURED-only; the "2 deps" framing is now inaccurate (X1); CLI/API drift in tutorials |
| **G — Community** | Complete governance + RFC (used) + contributor ladder + certification gradient + issue/mentored-task templates + `labels.yml` | No operational GFI backlog/mentor cadence; verified-author program has zero participants; no `MAINTAINERS`/contributors wall | Bus factor = 1 (X6); unverifiable "done" claims (X5); doc/label inconsistencies |

**Key takeaway:** there is **no workstream where the core capability is missing.** Every workstream's gaps are presentation, accuracy, or operationalization — exactly the "make it impossible to miss" mandate.

---

## 5. Workstream E — Ecosystem Homepage Refresh (assessed here)

Audited `docs/index.md` directly.

- **VERIFIED — it is already a discovery homepage, not a marketing page.** Sections: Hero (`npx @streetjs/cli create my-app`, copy button, GitHub/Docs CTAs) → a real code example → "Why StreetJS" 6-card grid (Auth, Realtime, DB/ORM, Jobs, AI, TypeScript-first) → **Showcase** (3 cards → `/showcase/`) → **Ecosystem** grid with cards for **Documentation, Examples, Plugins (→ `/plugins/marketplace/`), Starters (→ `/starters/`), Community, Security, Trust Center, GitHub** → final CTA. Hierarchy, trust, discovery, and ecosystem visibility are all present.
- **VERIFIED — claims are currently accurate:** "20+ official, signed, dependency-free plugins" (20 listed today) and "Scaffold a SaaS, AI, realtime or marketplace backend in one command with `--starter`" (all real).
- **GAP — no *featured plugins* section.** The brief asks for featured plugin cards (HTMX, MarzPay, OpenAI, Redis, Kafka, Stripe). Today the homepage links to the marketplace generically. Adding a small "Featured plugins" row sourced from `docs/_data/plugins.json` would satisfy the brief **without** hand-maintained data.
- **GAP — showcase cards deep-link to `/showcase/` generically**, not to per-app pages.
- **RISK (X4) — MarzPay must not be featured while unlisted.** The requested featured set includes MarzPay, but it is intentionally hidden from the marketplace. Feature only listed plugins (e.g. HTMX, OpenAI, Redis, Kafka, Stripe — all VERIFIED listed) and add MarzPay only if/when it is published and listed.
- **RECOMMENDATION (E):**
  - **E1** Add a data-driven "Featured plugins" row to the homepage that reads `site.data.plugins` (no manual duplication; auto-correct as plugins change). ROI **High**, Adoption **High**, Maintenance **Low**.
  - **E2** Keep the featured set to **listed** plugins only (exclude unlisted MarzPay) to stay consistent with the marketplace. ROI **High** (avoids a self-contradiction), Maintenance **Low**.
  - **E3** After X1 is fixed, ensure any homepage dependency phrasing uses the corrected, evidence-linked wording. ROI **Med**, Maintenance **Low**.
  - No core changes; homepage is a Jekyll template only.

---

## 6. Consolidated Implementation Order (all workstreams)

Ordered by **trust-impact first, then high-ROI visibility, then enrichment** — matching "visible, searchable, adoptable" with accuracy as the precondition.

**Phase 1 — Fix accuracy / trust (do first; cheap, high-trust, mostly docs):**
1. **X1** Correct the runtime-dependency count to 3 (`reflect-metadata`, `ws`, `zod`) on `/trust/`, the blog, and positioning; link `sbom.json`. *(D-REC-1, F-guardrail, E3)*
2. **X2** Derive marketplace trust badges (signed/dependency-free/dep-count) from real artifacts; resolve `plugin-htmx` signing. *(A-REC-1)*
3. **B-R1** Fix `docs/starters.md` SaaS attribution + add the `htmx` frontend and `--with-*` flags. *(starter accuracy)*
4. **D-REC-2/3** Re-point `/trust/` SBOM + threat-model links to the real artifacts and surface cosign/secret-scan/dependency-review/DAST/compliance rows.
5. **X3/X5** Mark prior plans/roadmaps superseded; reconcile stale counts and runtime-state claims.

**Phase 2 — High-ROI visibility (data-driven, low maintenance):**
6. **A-REC-2** Surface dependency count + maintainer + GitHub/source link on cards/detail pages.
7. **E1/E2** Add the data-driven "Featured plugins" homepage row (listed plugins only).
8. **C-REC-1** Add difficulty tiers + a learning path to `/showcase/` (markup only, zero new code).
9. **B-R4** Unify `street create` flag docs across the four docs to a single source of truth.
10. **G-R1 + G-R8** Seed the good-first-issue backlog from the existing 25 specs (using the existing `mentored_task.yml`) and fix the RFC-template / label inconsistencies.

**Phase 3 — Enrichment (higher effort, ongoing upkeep):**
11. **C-REC-2/4** Standardize per-card stack breakdowns; promote the CI-tested `reference-apps/*` into an "Advanced" gallery row.
12. **B-R2/R3** Per-starter feature lists + docs links; then screenshots + architecture diagrams.
13. **A-REC-3/4/5/6** Data-driven compatibility; version on hub cards; taxonomy reconciliation (alias "Authentication", decide on Realtime/Search/Observability/Integrations); data-driven `tier` for the Verified gradient.
14. **C-REC-5/6** Real screenshots + architecture diagrams for showcase.
15. **G-R2…R7** Batched mentorship, CI-gated verified-author program, contributor-ladder triggers, contributors wall, `MAINTAINERS` file.
16. **F** Execute the content roadmap (amplify the 3 live posts → SaaS/HTMX/realtime tutorials → native-driver depth → comparisons), MEASURED-only.

---

## 7. ROI / Adoption Impact / Maintenance Cost — top moves

| Rank | Move (workstream) | ROI | Adoption Impact | Maintenance Cost | Core change? |
|---|---|---|---|---|---|
| 1 | Fix the runtime-dependency count everywhere (X1, D) | **High** | High (security reviewers cross-check) | Low | No |
| 2 | Derive marketplace trust badges from artifacts (X2, A) | **High** | High (the core trust value prop) | Low | No |
| 3 | Surface deps + maintainer + GitHub link on plugins (A) | **High** | Med-High | Low | No |
| 4 | Data-driven "Featured plugins" homepage row (E) | **High** | High | Low | No |
| 5 | Showcase difficulty tiers + learning path (C) | **High** | High (newcomer on-ramp) | Low | No |
| 6 | Surface real supply-chain controls on `/trust/` (D) | **High** | High (enterprise scoring) | Low | No |
| 7 | Fix SaaS attribution + starter flag docs (B) | **High** | High (highest-intent entry) | Low | No |
| 8 | Seed good-first-issues from existing specs (G) | **Med-High** | High (contributor funnel) | Low (one-time) | No |
| 9 | Promote `reference-apps/*` into Advanced showcase row (C) | **High** | High (proof it builds real products) | Med | No |
| 10 | Per-starter docs/diagrams/screenshots (B/C) | **Med** | Med-High | Med-High | No |

Every top move is **non-core** and mostly **docs/generator/metadata** — consistent with "do not build new framework features."

---

## 8. Success-Criteria Mapping

| Brief success criterion | Current state | Gap to close |
|---|---|---|
| **Discoverable** | Marketplace + starters + showcase + homepage ecosystem grid all exist (VERIFIED) | Featured-plugins row; per-entry deep links; learning path |
| **Trustworthy** | Full real control set + signed plugins + `/trust/` page (VERIFIED) | Fix the dep-count error; derive badges from artifacts; surface the strongest controls |
| **Ecosystem-focused** | ~30 plugins, generator-driven, 9 categories (VERIFIED) | Maintainer/GitHub/dep-count surfacing; taxonomy reconciliation |
| **Starter-driven** | 6 real templates + aliases + frontends + flags (VERIFIED) | Accuracy fixes + richer `/starters/` discovery |
| **Plugin-driven** | Auto-generated marketplace, unlisted hidden (VERIFIED) | Truthful badges; featured row |
| **Without new framework features** | All recommendations are docs/generator/metadata | Hold the line — no core changes |

---

## 9. Guardrails (carry into execution)

- **No core framework changes.** Every recommendation in all seven plans is confined to docs, the Jekyll site, the marketplace generator, per-package metadata, the CLI overlay, or examples.
- **No claim without an in-repo evidence link.** If a desired claim has no backing file, add the evidence first or omit the claim. (Subtractive on one claim — X1; additive-with-evidence elsewhere.)
- **No fabricated content.** No fake starters (recommend roadmap pages), no showcase entry without runnable source, no customer case studies until a real consented adopter exists, MEASURED-only performance numbers.
- **Keep data auto-generated.** Prefer generator/`site.data`-driven surfaces (marketplace, featured-plugins row, contributors wall) over hand-maintained lists, so accuracy is self-correcting.
- **Respect `unlisted`.** Do not feature or list any plugin the generator intentionally hides.

---

## 10. Evidence Index (primary sources read for this master audit)

- `packages/` (full listing) and every `packages/plugin-*/package.json` + on-disk `manifest.signed.json` checks.
- `scripts/gen-plugins-data.mjs`, `docs/_data/plugins.json`, `docs/plugins/marketplace.md`.
- `packages/cli/src/commands/create.ts` (`TEMPLATES`, `STARTER_ALIASES`, `FRONTENDS`, `DATABASES`, `--with-*`).
- `docs/index.md` (homepage), `docs/starters.md`, `docs/showcase.md`, `docs/trust.md`.
- `examples/` tree (`01-rest-api`…`06-multiplayer`, `reference-apps/*`, `marzpay-*`).
- `.github/workflows/` (`scorecard.yml`, `codeql.yml`, `secret-scan.yml`, `dependency-review.yml`, `dast.yml`, `ci-cd.yml`, `publish-plugins.yml`); `sbom.json`; `scripts/generate-sbom.mjs`.
- `packages/core/package.json` (runtime deps: `reflect-metadata`, `ws`, `zod`) — basis for X1.
- Governance/community: `GOVERNANCE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `rfcs/*`, `.github/ISSUE_TEMPLATE/*`, `.github/labels.yml`, `.github/CODEOWNERS`, `docs/community/*`, `docs/ecosystem/*`.
- Prior artifacts reconciled: `PHASE-18-EXECUTION-PLAN.md`, `PLUGIN-MARKETPLACE.md`, `STARTERS-ROADMAP.md`, `SHOWCASE-ROADMAP.md`, `COMMUNITY-ROADMAP.md`, `ECOSYSTEM-PLUGINS-AUDIT.md`.
- Companion deliverables (this phase): `PLUGIN-MARKETPLACE-PLAN.md`, `STARTER-CATALOG-PLAN.md`, `SHOWCASE-GALLERY-PLAN.md`, `TRUST-CENTER-PLAN.md`, `CONTENT-ROADMAP.md`, `COMMUNITY-GROWTH-PLAN.md`.
