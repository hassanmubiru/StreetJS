# StreetJS Language Statistics Audit (GitHub Linguist)

> **⚠️ SUPERSEDED (2026-06-28): policy changed from "accuracy-first" to
> "presentation-first."** The maintainer subsequently chose to ALSO exclude
> hand-written test harnesses (`**/*.test.{mjs,js}`, `**/test/**`, `**/tests/**`)
> and build/automation tooling (`scripts/**`) from GitHub's displayed language
> bar, so the statistic reflects the **shipped product** (the TypeScript library
> in `packages/*/src`) rather than supporting tooling and tests. These files are
> genuine JavaScript the project authors and maintains — they are **not** vendored
> or generated; they are tagged `linguist-vendored` purely as the mechanism
> Linguist provides to drop files from the bar. The code remains tracked,
> reviewed, and maintained. The sections below that describe keeping `scripts/**`
> and tests counted ("integrity violation / do not apply") reflect the EARLIER
> policy and are retained for history; the active rules live in `.gitattributes`.
>
> Original note: Evidence-based. All byte figures are measured from **tracked**
> files (`git ls-files` + on-disk sizes), which is what Linguist counts. `dist/`
> and the SQLite `.wasm` are already `.gitignore`d, so they are not in scope.

## TL;DR

- The repo had **no `.gitattributes`** → zero Linguist overrides. (Fixed.)
- **~50% of all tracked JavaScript bytes are vendored or generated** and were
  being counted as if hand-written:
  - **Vendored** `packages/core/src/database/sqlite/sqlite3-node.mjs` — **387 KB**
    upstream SQLite WASM/Emscripten amalgamation (the single largest JS file).
  - **Generated** `**/dist-test/**` — **150 KB** of compiled-from-TypeScript test
    artifacts across 68 tracked files.
- The remaining JS (`scripts/*.mjs` automation ~330 KB, examples ~35 KB, package
  tests, configs) is **genuine source** and stays counted.

---

## Phase 1 — Repository breakdown (measured)

Tracked bytes by language (programming/markup only; `data` JSON/YAML and `prose`
Markdown are excluded from GitHub's language bar):

| Language   | Tracked bytes |
|------------|--------------:|
| TypeScript | 4209.0 KB |
| JavaScript | 1076.2 KB |
| Shell      |   59.2 KB |
| SCSS       |   48.0 KB |
| HTML       |   27.8 KB |
| Handlebars |    6.0 KB |

### JavaScript by area, tagged

| Area | JS bytes | Tag | Notes |
|------|---------:|-----|-------|
| `packages/core/src/database/sqlite/sqlite3-node.mjs` | 387.3 KB | **VENDORED** | Upstream SQLite WASM + Emscripten glue; "author disclaims copyright" |
| `**/dist-test/**` (68 files) | 150.4 KB | **GENERATED** | Compiled test bundles built from TS (`bundle.js`, `*.test.js`, `registry.js`, `server.js`) |
| `scripts/**/*.mjs` | 330.4 KB | **SOURCE CODE** | Real automation/CI/release/verification tooling — keep counted |
| `examples/**` | 35.0 KB | **SOURCE CODE** (runnable) | Demo apps; genuine, small — keep counted |
| `packages/*/test/*.test.mjs`, configs, misc | ~173 KB | **SOURCE CODE** | Genuine JS tests/config — keep counted |

Largest individual JS files (top 6): `sqlite3-node.mjs` 387 KB · `devtools/dist-test/bundle.js` 17 KB · `scripts/enterprise/e2e.mjs` 13.7 KB · `registry-server/dist-test/.../*-pbt.test.js` ~13 KB · `scripts/enterprise/server.mjs` 13 KB · `scripts/cloud/kind-verify.mjs` 12 KB.

---

## Phase 2 — Linguist analysis

Why JavaScript is ~17% despite a TS-first codebase:

| Directory | Current impact | Recommended action | Reason | Risk |
|-----------|----------------|--------------------|--------|------|
| `…/sqlite/sqlite3-node.mjs` | 387 KB JS (~36% of all JS) | `linguist-vendored=true` | Third-party upstream amalgamation, not StreetJS source | None — legitimate vendoring |
| `**/dist-test/**` | 150 KB JS (~14% of all JS) | `linguist-generated=true` | Compiled output of the repo's own TS; not authored JS | None — legitimate generated tag |
| `scripts/**/*.mjs` | 330 KB JS | **Keep counted** | Genuine, hand-written automation source | N/A — excluding it would be inflation |
| `examples/**` | 35 KB JS | **Keep counted** (optional doc tag) | Runnable demo source; small | Low — could mark `linguist-documentation`, but integrity-first default is keep |
| `**/package-lock.json` | data (not in bar) | `linguist-generated=true` | Lockfile; matches Linguist defaults | None |

---

## Phase 3 — `.gitattributes` audit

- **Before:** file did **not exist**. No `linguist-*` rules anywhere. Every
  vendored/generated JS byte was counted as authored JavaScript.
- **Missing rules:** vendoring for the SQLite shim; generated for `dist-test`.
- **Incorrect rules:** none (none existed).
- **Opportunity:** also flag tracked lockfiles/`dist` defensively.

---

## Phase 4 — Recommended fixes (production-ready)

Committed as `.gitattributes` (only legitimate classifications; no source hidden):

```gitattributes
# VENDORED — upstream SQLite WASM/JS amalgamation (Emscripten glue + sqlite3 JS API)
packages/core/src/database/sqlite/sqlite3-node.mjs linguist-vendored=true

# GENERATED — compiled test artifacts checked into the repo (built from TS)
**/dist-test/** linguist-generated=true

# GENERATED — build output that may be tracked (dist/ is normally gitignored)
**/dist/** linguist-generated=true

# GENERATED — npm lockfiles (data; matches Linguist defaults)
**/package-lock.json linguist-generated=true
```

**Deliberately NOT excluded:** `scripts/**/*.mjs` (≈330 KB) and `examples/**`
(≈35 KB) — these are genuine, hand-written JavaScript the project authors and
maintains. Hiding them to raise the TypeScript number would violate Linguist
guidelines and repository integrity.

---

## Phase 5 — Impact forecast (ranges)

Removing the vendored shim (387 KB) + generated `dist-test` (150 KB) eliminates
~538 KB — **~50% of all JS bytes** — while leaving TypeScript essentially
unchanged.

| Metric | Current (reported) | Expected after fixes |
|--------|--------------------|----------------------|
| TypeScript | ~81% | **~88–93%** |
| JavaScript | ~17% | **~8–11%** |
| Shell / others | ~1.5% | ~1.5–2% |

Reasoning: JavaScript's share roughly halves; TypeScript and the small remaining
languages absorb the freed share. Ranges (not exact figures) account for
Linguist's own classification nuances and the small TS `.d.ts` inside `dist-test`
that also drops out. **No precision is fabricated.**

---

## Phase 6 — Open-source best practices

How mature repos handle this — and where StreetJS now aligns:

- **Generated artifacts** (Next.js, Nuxt, NestJS): compiled output is gitignored
  or marked `linguist-generated`. StreetJS marks `dist-test`/`dist` generated.
  *Stronger follow-up:* stop tracking `dist-test` entirely (rebuild in CI) — see
  recommendation below.
- **Vendored code** (all): third-party amalgamations (e.g., WASM glue) are marked
  `linguist-vendored`. StreetJS now does this for the SQLite shim.
- **Examples** (Next.js `examples/`, Nuxt): often a separate workspace; some mark
  them `linguist-documentation`. StreetJS keeps its small examples counted as
  source (integrity-first) — acceptable and honest.
- **Templates** (Hono/Fastify create-tools): scaffold templates are real source
  and stay counted. StreetJS embeds templates as TS string literals in
  `packages/cli`, so they already count as TypeScript.
- **Language stats**: mature projects rely on `linguist-generated`/`-vendored`
  only — never on hiding authored code. StreetJS now matches that bar.

**Follow-up recommendation (not required for the fix):** `**/dist-test/**` is
compiled output checked into git. Consider `.gitignore`-ing it and rebuilding in
CI; the `linguist-generated` tag is the safe immediate fix either way.

---

## Deliverables

### 1. Findings summary

| Finding | Severity |
|---------|----------|
| No `.gitattributes` / no Linguist overrides | High |
| 387 KB vendored SQLite JS counted as source | High |
| 150 KB generated `dist-test` JS counted as source | Medium |
| `dist-test` compiled artifacts tracked in git | Low (hygiene) |
| Genuine `scripts/*.mjs` source correctly counted | Informational (no action) |

### 2. Proposed `.gitattributes`

Committed to the repo root (see Phase 4 block / the live `.gitattributes`).

### 3. Risk assessment

| Rule | Impact | Risk | Recommendation |
|------|--------|------|----------------|
| `sqlite3-node.mjs` → vendored | −387 KB JS | None (genuinely third-party) | Apply |
| `**/dist-test/**` → generated | −150 KB JS | None (genuinely compiled) | Apply |
| `**/dist/**` → generated | 0 now (gitignored) | None | Apply (defensive) |
| `**/package-lock.json` → generated | 0 to bar (data) | None | Apply (correctness) |
| (declined) exclude `scripts/**` | would be −330 KB | **High — integrity violation** | Do **not** apply |

### 4. Final score

| Category | Score |
|----------|-------|
| Accuracy | 9/10 |
| Maintainability | 9/10 |
| Open Source Integrity | 10/10 |
| **Overall** | **9.3/10** |

The fix makes the stats reflect authored code (vendored/generated excluded),
remains fully transparent and Linguist-compliant, and hides no source.

---

## Phase 7 — Active policy (2026-06-28): presentation-first

The maintainer elected to make GitHub's language bar represent the **shipped
product** rather than the entire repository. In addition to the vendored/generated
exclusions above, the following hand-written files are now excluded from the bar
via `.gitattributes`:

| Path pattern | Tag used | Nature (honest) | Why excluded |
|--------------|----------|-----------------|--------------|
| `**/*.test.mjs`, `**/*.test.js`, `**/test/**`, `**/tests/**` | `linguist-vendored` | Genuine authored test harnesses | Tests are not part of the shipped library |
| `scripts/**` | `linguist-vendored` | Genuine authored automation/CI/release tooling | Tooling is not part of the shipped library |

**Honesty note:** these files are NOT third-party and NOT generated. `linguist-vendored`
is used only because it is the mechanism Linguist offers to drop files from the
statistic; there is no "test" or "tooling" category. This is a deliberate
presentation choice, not a correctness claim. All such code remains tracked,
reviewed, tested, and maintained, and continues to appear in normal diffs, blame,
and search.

**Effect:** the displayed bar now approximates the `packages/*/src` composition
(~92% TypeScript). The actual repository composition is unchanged and still
measurable with `git ls-files` as documented in Phases 1–2.

**Reversal:** to return to the accuracy-first policy, remove the "Presentation
overrides" block from `.gitattributes`; the vendored SQLite shim and generated
`dist-test` exclusions (Phase 4) should remain regardless, as those are
genuinely vendored/generated.
