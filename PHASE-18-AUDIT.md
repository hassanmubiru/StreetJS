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
- **~30 `plugin-*` packages**; the marketplace lists **21** and hides **0** (`plugin-marzpay` was `streetjs.unlisted` during the audit and has since been published & listed — see *Post-audit follow-ups*). 9 categories. (`docs/_data/plugins.json`, `scripts/gen-plugins-data.mjs`.)
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

### X4 — RESOLVED: MarzPay is now published & listed
- **Original tension:** the brief asked the homepage to feature MarzPay, but `packages/plugin-marzpay/package.json` set `streetjs.unlisted: true`, so the generator hid it.
- **Resolution (applied):** the `unlisted` flag was removed and `plugin-marzpay` added to the `publish-plugins.yml` matrix. The generator now **lists** it (Payments, v1.0.0, signed — `plugins.json` count is **21**), and it is featured on the homepage. Build/sign/test verified (67 tests pass). **It is not yet on npm** — the publish is a credential-gated CI action: run the `Publish Plugins` workflow (tag `plugins-v*` or manual dispatch with `plugin: plugin-marzpay`) which uses the `NPM_TOKEN` + `STREET_PLUGIN_SIGNING_KEY` secrets and publishes with provenance + official Ed25519 signature.

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
| **A — Marketplace** | Auto-generated from `packages/plugin-*` (single source of truth); 21 listed / 0 hidden; search + category filter + detail pages + install + npm links + version (detail) + static compatibility; unlisted exclusion works | Maintainer info, visible GitHub link, numeric dependency count; requested categories Realtime/Search/Observability/Integrations have no mapping/plugins; version not on hub card | Hardcoded trust badges; htmx shown signed but unsigned (X2); static compat can drift |
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
- **VERIFIED — claims are currently accurate:** the marketplace count is data-driven (**21 listed** today, `{{ site.data.plugins.count }}` in copy) and "Scaffold a SaaS, AI, realtime or marketplace backend in one command with `--starter`" (all real). A data-driven **Featured plugins** row was since added (E1/E2), so this GAP is resolved.
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

### Phase 1 — Execution status (APPLIED)

All Phase-1 (accuracy/trust) items are now implemented — docs/generator/metadata only, no core changes:

- **X1 — DONE.** Corrected the runtime-dependency count to **3 (`reflect-metadata`, `ws`, `zod`)** across every live doc surface: `docs/trust.md`, `docs/faq.md`, `docs/about.md`, `docs/README.md`, `docs/getting-started/installation.md`, `docs/use-cases/index.md` (incl. the now-accurate "Zod-backed `@Validate`" line), `docs/enterprise/{procurement-faq,architecture-overview,risk-assessment}.md`, `docs/deployment/budget.md`, `docs/adoption/go-to-market-roadmap.md`, `docs/STREETJS-READINESS-ASSESSMENT.md`, and the blog index/posts. `sbom.json` linked as proof. (Marketing drafts under `docs/_marketing/` and internal planning docs left as optional follow-up.)
- **X2 — DONE.** `scripts/gen-plugins-data.mjs` now **derives** `signed`/`dependencyFree`/`thirdPartyDepCount` from on-disk artifacts (`manifest.signed.json` existence + `dependencies` minus `streetjs`); detail pages render trust signals conditionally and add a Source/GitHub link + runtime-dependency line. Regenerated: **19/20 signed**; `plugin-htmx` now honestly shows "manifest signing pending" instead of a false signed badge.
- **B-R1 — DONE.** `docs/starters.md` SaaS row no longer mis-attributes `@streetjs/admin`; added the `htmx` frontend, the `--with-billing/--with-marzpay/--with-admin-ui/--with-email` table, and an "optional enhancement" note for `@streetjs/admin`.
- **D-REC-2/3 — DONE.** `docs/trust.md` SBOM row now links the real `sbom.json` + generator; threat-model links `docs/THREAT-MODEL.md`; added rows for cosign release signing, secret scanning, dependency review, DAST, and compliance control mappings (all to verifiable in-repo artifacts); enterprise checklist updated.
- **X3/X5 — DONE.** `STARTERS-ROADMAP.md` carries a SUPERSEDED banner (the "no `--starter` flag" claim is struck/resolved); `PHASE-18-EXECUTION-PLAN.md` and `PLUGIN-MARKETPLACE.md` counts reconciled to **20 plugins / 9 categories** with generator-driven caveats; `docs/cli-reference.md` and `docs/roadmap.md` updated for the real `htmx` frontend, `ai` starter, and `--with-*` flags.

### Phase 2 — Execution status (APPLIED)

- **A-REC-2/3/4 — DONE.** `gen-plugins-data.mjs` now emits `author`, `streetjsRange`, `nodeRange`, `tsRange` per plugin; detail pages show a **Maintainer** line, a **runtime-dependency** line, a **Source/GitHub** link, and a **data-driven Compatibility matrix** derived from each package's `dependencies.streetjs` / `engines.node` / `peerDependencies.typescript` (e.g. `plugin-africastalking` correctly shows `streetjs ^1.0.9` vs others' `^1.0.6`). Hub cards (`marketplace.md`) now show **version + signed indicator**.
- **E1/E2 — DONE.** Added a data-driven **"Featured plugins"** row to `docs/index.md` sourced from `site.data.plugins` (featured set: stripe, openai, redis, kafka, postgres, htmx). By construction it can only show **listed** plugins (the generator excludes unlisted MarzPay), satisfying E2; signing/dep badges render from real data.
- **C-REC-1 — DONE.** `docs/showcase.md` gained **difficulty tiers** (Beginner/Intermediate/Advanced) on every card, a client-side **difficulty filter**, and a **6-step learning path**.
- **B-R4 — DONE.** `street create` flag docs unified across `docs/starters.md`, `docs/cli-reference.md`, `docs/showcase.md`, and `docs/roadmap.md` (single accurate surface: frontends incl. `htmx`, `ai` starter, `--with-*` flags).
- **G-R8 — DONE.** Added the missing `bug`/`triage`/`enhancement` labels to `.github/labels.yml` (referenced by the issue templates); corrected `GOVERNANCE.md`'s stale "open an RFC issue from the `rfc` template" instruction to the real **PR-based** flow via `rfcs/0000-template.md`. **Also operationalized the manifest**: added `scripts/sync-labels.mjs` (dependency-free, tested via `--dry-run`) + `.github/workflows/labels.yml` (pinned `actions/checkout`, preinstalled `gh`, non-destructive) so the labels are actually applied to the live repo — closing the "manifest ≠ live labels" risk.
- **G-R7 / X6 — PARTIAL (DONE in source).** Added an honest [`MAINTAINERS.md`](MAINTAINERS.md) (sole maintainer, bus factor = 1, "Steering Committee activates at N ≥ 3") and pointed `GOVERNANCE.md` at it.

### Phase 3 — Execution status (APPLIED where source-verifiable)

- **C-REC-2/4 — DONE.** Promoted the CI-tested `examples/reference-apps/*` (realtime-chat, ai-assistant, ecommerce, saas, dating) into an **"Advanced reference applications"** row on `docs/showcase.md`, each with a real source link and the CI workflow as evidence. (MEASURED benchmark numbers deliberately omitted from the marketing surface.)

### Remaining items that require external assets or GitHub-runtime actions (NOT fabricated)

These cannot be completed from repository source without violating the "no fabrication / no claims without evidence" guardrail. They are the genuine remaining work and require a human/asset/runtime step:

- **C-REC-5/6, B-R3 — architecture diagrams DONE for the SaaS starter; screenshots remain external.** Added an accurate, source-verified ASCII architecture diagram for the SaaS starter to `docs/starters.md` (modules, tenant scoping, opt-in overlays). Further per-app diagrams are authorable the same way on request. **Real screenshots** still require running each app and capturing UI — the showcase uses clearly-labeled illustrative SVG covers until then. *Action: capture screenshots into `docs/assets/images/…`.*
- **G-R1 — seed the good-first-issue backlog.** The label and 25 scoped candidates exist in source; a **curated, reconciled, ready-to-file backlog now exists** at [`GOOD-FIRST-ISSUES.md`](GOOD-FIRST-ISSUES.md) (stale/shipped candidates removed). The only remaining step is the GitHub-runtime action of **filing the issues** via the existing `mentored_task.yml` template (+ label-sync). *Action: `gh issue create` / label-sync.*
- **X5 / Discussions — enable + seed GitHub Discussions.** Repo-setting + content; not verifiable from source. *Action: enable Discussions; seed threads.*
- **A-REC-5/6 — taxonomy/tier enrichment.** The brief's "Authentication / Realtime / Search / Observability / Integrations" categories have no backing `plugin-*` packages today; adding empty category pages would be thin-content. `tier` is uniformly "Official" until a real third-party (Verified/Community) plugin exists. *Action: revisit when such plugins land — keep generator-driven.*
- **F — content roadmap execution.** Writing the tutorials/articles in `CONTENT-ROADMAP.md` is ongoing editorial work, MEASURED-only.

### Post-audit follow-ups (applied)

- **Site footer attribution removed.** `docs/_includes/components/footer.html` overrides the just-the-docs theme footer to render only the back-to-top link and the project's own `footer_content`, deliberately omitting the theme's "This site uses Just the Docs…" line.
- **Publish pipeline fixed for MarzPay.** `plugin-marzpay` added to the `.github/workflows/publish-plugins.yml` matrix; build + sign + test paths verified locally (tsc clean, 67 tests pass, committed official signed manifest present). The actual npm publish runs in CI (tag `plugins-v*` / manual dispatch) with `NPM_TOKEN` + `STREET_PLUGIN_SIGNING_KEY` — it cannot be run from a workstation without those secrets.
- **MarzPay listed & publish-ready (X4 resolved); npm publish pending CI.** `streetjs.unlisted` removed; the generator now lists it (Payments, v1.0.0, signed) — `plugins.json` count is **21 / 9 categories** — and it is featured on the homepage. It is **not yet on npm** (`npm view @streetjs/plugin-marzpay` → 404): the actual publish is a credential-gated CI action (see below).

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
