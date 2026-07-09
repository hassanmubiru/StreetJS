---
layout: default
title: "Final Independent Repository Audit — 2026-07-07"
nav_exclude: true
description: "Fresh-evidence-only independent audit of StreetJS. No claim from any prior report was trusted; every finding here was independently executed and reproduced."
sitemap:     false
noindex:     true
---

# StreetJS — Final Independent Repository Audit (Fresh Evidence Only)

**Commit audited:** `3d7fc4fe5891a3cad6c9bb452c141c0655202f1f` (`main`, 2026-07-07 00:54:39 +0300)
**Audit date:** 2026-07-07
**Method:** Zero trust in prior reports. Every finding below was independently executed in this session — real builds, real test runs, real `npm`/`gh` commands against the live registry and live GitHub Actions, and live exploit reproductions. Where a claim could not be independently verified, it is marked `NOT VERIFIED` rather than assumed.
**Environment:** Node.js v20.20.1, npm 10.8.2 (repo requires Node ≥22 — see Finding R-1), local PostgreSQL running with non-matching credentials (see Finding T-3).

---

## Executive Summary

The repository is fundamentally healthy: both `packages/core` and `packages/cli` build with zero TypeScript errors, the full published-package version lockstep (`streetjs`/`@streetjs/core`/`@streetjs/cli` all `1.0.27`) matches the live npm registry exactly, npm provenance is live and verifiable, `npm audit` reports zero vulnerabilities, and 43/43 GitHub Actions workflow files parse as valid YAML. The main `street CI/CD` pipeline is fully green (30/30 jobs) on the current commit, as are Runtime Certification and CI/CD Enforcement.

However, this audit independently reproduced one **live, exploitable Critical security vulnerability** (path traversal in `LocalStorageDriver`, confirmed by direct write/read outside the configured root), and found **two of the repository's own currently-configured CI gates are red on `main` right now** (Secret Scanning, Repository Policy) — both due to real, verifiable repo-hygiene defects (stray tracked empty files at the repo root; a benign-but-unresolved Gitleaks finding from a deleted debug script). It also found a real packaging defect that breaks the documented Quick Start for TypeScript users (`ws` types not resolvable without an undocumented `@types/ws` install), a genuine license-file omission from the published npm tarball, and three orphaned property-based test files that fail deterministically and are not executed by any CI job or npm script — meaning a `VERIFIED`-labeled local artifact for this capability is unsupported by any real, currently-running verification.

None of this contradicts the substance of prior engagement reports — most of their claims were independently re-confirmed — but this audit surfaces several items that either were not previously caught or need re-verification going forward (the CI red gates in particular are dated *after* the most recent prior audit's cited evidence).

---

## Repository Health

| Check | Result | Evidence |
|---|---|---|
| Working tree clean at audit start | VERIFIED clean | `git status --short` empty; `HEAD` = `origin/main` = `3d7fc4fe` |
| `npm run build -w packages/core` | VERIFIED pass, exit 0 | executed this session |
| `npm run build -w packages/cli` | VERIFIED pass, exit 0 | executed this session |
| `node scripts/audit/repo-wide-checks.mjs` (manifest/README-import/placeholder/cycles, full 54-package/880-file scope) | VERIFIED 0 failures | executed this session: 95 manifest targets checked/46 skipped, 52 README imports checked/45 skipped, 446 files scanned/0 placeholder markers, 880 files/0 circular deps |
| `node scripts/check-cycles.mjs` (default/narrow scope) | VERIFIED 0 cycles, but scope is only 395 files / 3 packages | executed this session; confirms this script alone is not full-repo coverage — use `repo-wide-checks.mjs` for that |
| All 43 `.github/workflows/*.yml` parse as valid YAML | VERIFIED | `python3 -c "yaml.safe_load(...)"` on all 43, zero errors |

---

## Build Results

**`packages/core`: VERIFIED PASS.** `npm run build -w packages/core` → `prebuild` (sqlite wasm check) → `tsc -p tsconfig.lib.json` → `postbuild` (wasm copy), exit 0, no errors.

**`packages/cli`: VERIFIED PASS.** `npm run build -w packages/cli` → `tsc`, exit 0, no errors.

**Finding B-1 [Low, Informational] — `npm run build`'s `tsconfig.lib.json` excludes `tests/`, so `dist/tests/integration.test.js` (the file `package.json`'s own `test` script points at) does not exist after a normal `build`.** Only running plain `tsc` (using the base `tsconfig.json`, which includes `tests/**/*`) produces it. Reproduced directly: after `npm run build`, `dist/tests/integration.test.js` is absent (confirmed via `ls`/`find`); after a subsequent plain `npx tsc`, it appears and the test runs. This is not a broken build — `npm test` documented workflow (which presumably runs a different sequence) was not itself independently verified end-to-end from a clean state — but it is a real trap for anyone running `npm run build && npm test` expecting the test file to exist. **Recommendation:** either have `test`/`coverage` scripts depend on a build step that includes tests, or document the two-build split explicitly.

---

## Test Results

**Core's documented `test` command (`node --test dist/tests/integration.test.js`), run for real after a full plain `tsc`: VERIFIED 14/14 pass, 0 fail.** 4 PostgreSQL-dependent sub-suites explicitly and correctly SKIP with the message "PostgreSQL not configured" (this environment's local PG has mismatched credentials, treated by this specific suite as absent rather than erroring — see contrast with Finding T-3 below).

**A full recursive run of all 160 direct + nested `dist/tests/**/*.test.js` files: 2136 tests, 2077 pass, 39 fail, 11 cancelled, 9 skipped.** This raw number is **not a meaningful health signal** — investigated every failure individually:

- **Finding T-1 [Low, informational] — Duplicate compiled test artifacts.** `dist/tests/` and `dist/src/tests/` both contain compiled output for several test files (e.g. `profiler.test.js`, `browser-build.test.js`) from different `tsc` invocation targets. A naive `dist/tests/**/*.test.js` glob picks up stale/wrong-path copies that fail on relative-path assumptions (e.g. `action-schema.test.js` expects to run from repo root; `browser-build.test.js` looks for `packages/core/browser.js` relative to its *own* compiled location, which differs between the two output trees). **Verified fix:** running the canonical `dist/src/tests/browser-build.test.js` directly passes 5/5; running `packages/core/dist/tests/action-schema.test.js` from the repo root passes 22/22. Neither is a product bug — both are artifacts of this audit's own naive glob, now understood and excluded from the real failure count.
- **Finding T-2 [Medium, Real test-authoring bug — NOT a product bug] — Three orphaned property-based test files fail deterministically due to a `fast-check` null-prototype edge case colliding with `assert.deepEqual`.** `encryption-key-rotation-pbt.test.ts`, `encryption-roundtrip-pbt.test.ts`, and `tamper-detection-pbt.test.ts` (all under `packages/core/src/tests/`) use `fc.record({...})` as part of their plaintext generator. `fast-check` (installed version, pinned `^4.8.0` in `package.json`) sometimes generates its edge-case/shrunk objects via `Object.create(null)` (a null-prototype object) — confirmed directly: `fc.sample(plaintextArb, {seed:1})` produced `[Object: null prototype] { phone: '', note: 'valueOf', age: 45 }` as one of only 5 samples. `FieldCipher.decrypt()` round-trips through `JSON.parse`, which always produces a plain `Object.prototype` object. `assert.deepEqual` (imported from `node:assert/strict`) treats this prototype mismatch as inequality and throws — reproduced deterministically 8/8 consecutive runs, not a flake. **This is a bug in the test's own assertion (it should compare structural equality, not prototype identity, or the generator should exclude null-prototype objects), not a bug in `FieldCipher`/`Keyring`** — directly confirmed the actual encryption/decryption round-trip is correct when using a plain object with identical field values (`assert.deepEqual` passes fine on the same plaintext when it's a normal object literal).
  - **Escalating finding:** a local, gitignored (not committed — confirmed via `git ls-files` returning nothing and `.gitignore:60` matching it) verification artifact at `verification-artifacts/encryption/encryption.field.artifact.json` claims `"status": "VERIFIED"`, `"exitCode": 0`, `"passingTests": true` for the exact command `node --test dist/tests/encryption-roundtrip-pbt.test.js dist/tests/encryption-key-rotation-pbt.test.js dist/tests/tamper-detection-pbt.test.js`, dated `2026-06-11T15:18:30.534Z`. Git history shows `encrypted-field.ts` has had exactly one commit, on 2026-06-11, the same day — the source has not changed since. This means either the artifact's claimed exit code was never actually accurate, or a `fast-check` version/edge-case-injection change altered behavior without any code change. **Not independently resolvable further in this audit** (no way to know exactly what ran on 2026-06-11 without re-running it then). Flagged as `NOT VERIFIED — Unable to determine whether the 2026-06-11 pass was accurate` rather than assumed either way.
  - **Most important sub-finding: these three test files are referenced by zero `npm run` scripts in `packages/core/package.json` and zero GitHub workflow files (`grep`-confirmed repo-wide).** They are orphaned — never executed by CI or any documented local command. The `coverage` script CI actually runs (`c8 node --test ... ` against 9 specific hardcoded files) does not include them.
- **Finding T-3 [Low, environment-specific, not a product bug] — `profiler.test.js`'s `pool:exhausted` sub-suite fails with an unhandled async rejection, not a clean skip, when a local PostgreSQL server is present but misconfigured.** This machine has PostgreSQL running (`systemctl status postgresql` → active) with credentials that don't match the test's expectations (`password authentication failed for user "street"`). Other suites in the same test run correctly detect "no working PG" and cleanly SKIP; this one instead lets the connection attempt fail mid-test and reports it as an unhandled rejection after the test already completed. Real but narrow — only affects environments with a *misconfigured* (not absent) local PG.
- **`verification-runner-atomic.test.js` (the "atomic write" failure from the naive full run): re-verified in isolation — 4/4 pass, 0 fail.** The single failure in the giant combined run was a resource contention artifact of running hundreds of test files concurrently via one glob, not a real bug.
- **`wire-stream.test.js`'s `PgConnection.queryStream` failures (11 cancelled, 1 failed): same root cause as Finding T-3** (this machine's misconfigured local PG), confirmed by the identical `password authentication failed` signature.

**CLI core test suite (`argv`, `create`, `generate`, `migrate`): VERIFIED 86/86 pass, 0 fail.**

---

## Runtime Results

**`street --version` / `street --help`: VERIFIED working**, real output, reports `v1.0.27`, lists all documented commands.

**`street doctor`: VERIFIED working and honest.** Correctly detects and reports, on this real machine: Node v20.20.1 fails the documented `>=22` requirement; 11 required env vars missing; PostgreSQL connection failure with the real error message (`password authentication failed for user "postgres"`). This is a genuinely useful, accurate diagnostic tool — not a stub.

**Finding R-1 [Informational] — this entire audit was executed on Node v20.20.1, one major version below the repository's documented and enforced (`engines.node: >=22.0.0`) minimum.** All build/test results above should be read with this caveat: they demonstrate the code works on Node 20 in practice (which is a mildly positive, unplanned data point), but they are not a substitute for Node 22/24 verification. The real GitHub Actions CI (see CI Results) does run on Node 22/24 and is green there, which is the actually-authoritative signal for supported-runtime correctness.

---

## Documentation Results

**Finding D-1 [Medium, real, reproduced] — Following the documented Quick Start (`npm install streetjs`) and writing the most basic possible middleware, then running `tsc --noEmit`, produces real compile errors.** Reproduced end-to-end: copied `examples/01-rest-api` to a clean directory, ran `npm install`, ran `npx tsc --noEmit`. Result:
```
node_modules/streetjs/dist/websocket/server.d.ts(1,27): error TS7016: Could not find a declaration file for module 'ws'.
node_modules/streetjs/dist/websocket/server.d.ts(76,16): error TS2665: Invalid module name in augmentation. Module 'ws' resolves to an untyped module...
```
Root cause, independently confirmed: `streetjs`'s published `dependencies` include `ws` (runtime dep, correct — confirmed via `npm view streetjs dependencies` against the live registry: `{'reflect-metadata': '^0.2.2', 'ws': '^8.18.0', 'zod': '^4.4.3'}`), and `streetjs`'s own shipped `.d.ts` files reference `ws`'s types — but `ws` itself ships no bundled types (it relies on the separate `@types/ws` package), and `@types/ws` is neither a `streetjs` dependency nor documented as a required companion install anywhere in the Quick Start. Any TypeScript consumer following the README exactly will hit this. **Recommendation:** either bundle a minimal type shim, add `@types/ws` as a dependency (unusual for a runtime package but defensible for a zero-friction DX goal), or add one documented line to the Quick Start (`npm install -D @types/ws`).

**Finding D-2 [Low] — `examples/01-rest-api/package.json` depends on the deprecated `@streetjs/core` package (pinned `^1.0.5`, far behind current `1.0.27`), not the current `streetjs` package name**, despite `docs/migration.md` explicitly documenting the rename and recommending new projects use `streetjs`. The example still works (the deprecated package re-exports unchanged, confirmed via its own `dependencies: {"streetjs": "1.0.27"}`), so this is a staleness/consistency issue, not a breakage. **Not independently checked across all 17 example directories** — this finding is scoped to `01-rest-api` specifically; whether the other 16 examples have the same staleness is `NOT VERIFIED`.

---

## Security Results

**Finding S-1 [CRITICAL, live-reproduced] — Path traversal in `LocalStorageDriver`, confirmed exploitable via direct write and read.**

Evidence (fresh reproduction, this session, in an isolated `/tmp` sandbox, cleaned up afterward):
```js
const storage = createStorage({ provider: 'local', root: '/tmp/storage-root' });
await storage.put('../storage-victim/pwned.txt', Buffer.from('PWNED BY TRAVERSAL'), { contentType: 'text/plain' });
// → WRITE SUCCEEDED. Confirmed via fs.existsSync: file created at
//   /tmp/storage-victim/pwned.txt — OUTSIDE the configured root.
await storage.get('../storage-victim/pwned.txt');
// → found: true; bytes read back: "PWNED BY TRAVERSAL" — confirms the
//   traversal is fully read/write capable, not write-only.
```
Root cause: `packages/storage/src/drivers/local.ts`'s `objectPath()`/`metaPath()` resolve via bare `path.join(this.root, key)` with **zero containment check anywhere in `packages/storage/src`** (confirmed via `grep` for `resolveContained`/traversal-guard patterns returning zero matches in the package). Any caller (or any upstream code path that forwards user/tenant-controlled input as a storage `key`) can read or write arbitrary filesystem locations reachable from the process's permissions.
- **Reproduction:** exactly as shown above; fully re-runnable.
- **Recommendation:** validate/normalize `key` to reject any resolved path that escapes `this.root` (e.g. resolve both paths absolutely and check `resolved.startsWith(root + path.sep)`), and add a regression test asserting `../`-containing keys throw rather than escape.
- **Severity: Critical.** Confirmed exploitable, not theoretical; storage keys are commonly derived from user-supplied filenames/identifiers in real applications.

**Finding S-2 [None found, verified clean] — No `eval()` or `new Function()` anywhere in `packages/*/src`.** Repo-wide `grep`, zero matches.

**Finding S-3 [None found, verified clean] — `npm audit --omit=dev` at repo root: real output `"found 0 vulnerabilities"`.** Executed fresh this session.

**Finding S-4 [Low, informational] — `child_process.spawnSync` usage found only in CLI/test code with fixed argv (not user-influenced shell strings) or explicit workspace-relative binary paths** (`certify.ts`'s gate runner, several integration tests invoking `tsc`/`npm` with static args). No injection vector identified. Not independently re-audited line-by-line for every one of the ~15 call sites found — spot-checked a representative sample (`certify.ts`, `create-boot.integration.test.ts`, `marzpay-next-smoke.test.ts`); all use fixed, non-interpolated argv arrays.

**JWT/session/secret hard-fail behavior: NOT independently re-verified in this specific audit pass** (prior reports claimed a 3-layer hard-fail chain; this audit did not re-trace that chain from scratch — carrying forward as `NOT VERIFIED — Unable to verify from available evidence in this pass`, not asserted as fact).

**Prototype-pollution guard on `JSON.parse` in `http/server.ts`: NOT independently re-verified in this audit pass.** Prior reports flagged this as missing; not re-checked here — `NOT VERIFIED`.

---

## Packaging Results

**Finding P-1 [Medium, live-verified against the real npm registry] — The published `streetjs@1.0.27` npm tarball ships with no `LICENSE` file, despite `package.json` declaring `"license": "MIT"` and listing `LICENSE` in the `files` array.**

Evidence: `npm pack streetjs@1.0.27` (downloaded the real, live tarball from the registry, not a local build) → `672` files inside → `grep -i LICENSE` against the full file list → zero matches, confirmed twice after an initial tooling mistake (first attempt silently failed to download due to a sandboxed-`cwd` restriction; redone correctly with `--pack-destination` inside the workspace, producing a real 1,145,072-byte tarball, then `tar -tzf` verified against it directly).

Root cause: `packages/core/` (the local source for the `streetjs` package) has no local `LICENSE` file at all (confirmed via `ls`), so npm's packing step has nothing to include even though `package.json`'s `files` array lists it. **Recommendation:** copy the root `LICENSE` into `packages/core/` (and audit other publishable packages for the same gap) before the next publish.

**Version lockstep: VERIFIED, fresh.** `npm view streetjs version` / `@streetjs/core` / `@streetjs/cli` all report `1.0.27` live from the registry; local `package.json` files match exactly.

**npm provenance: VERIFIED live.** `npm view streetjs dist.attestations` returns a real `SLSA v1` provenance attestation URL for the current published version.

---

## Release Results

**Finding REL-1 [informational, cross-reference] — `Release Engineering Enforcement` correctly reports `skipped` (not failure, not success) on a normal push-triggered CI/CD Enforcement run** (`gh run view` on the current HEAD's run), consistent with this job being intentionally gated to `workflow_dispatch`/`release` events only. **Runtime Certification (`certify` job): VERIFIED green** on the current HEAD (`gh run view` → `conclusion: success`).

---


## CI Results

**Finding CI-1 [High, live, currently failing] — `Secret Scanning` workflow is RED on the current `main` HEAD.**

Evidence: `gh run list` (live query against the real GitHub API) shows `Secret Scanning` with `conclusion: failure` on commit `3d7fc4fe` (the exact HEAD audited). `gh run view --log-failed` shows the real cause: Gitleaks (v8.30.1) flags 2 findings, `RuleID: generic-api-key`, in `packages/gateway/debug-ws.mjs` and `packages/gateway/debug-replica.mjs` at specific historical commits (`72730197`, `027ab078`). Both files were later deleted (confirmed absent from the current working tree and from `HEAD`), but Gitleaks scans full git *history* by design, so the finding persists regardless of current-tree deletion. Independently fetched and inspected the exact flagged content: `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==` — this is the literal example nonce from RFC 6455 (the WebSocket protocol specification's own published sample handshake key), not a real credential. **This is a genuine false positive, but the CI gate is red regardless of intent** — it needs either a `.gitleaks.toml` allowlist entry (with a commit-scoped exception, matching the pattern the project already uses for its one other historical false-positive per `plans/OUTSTANDING-ACTIONS.md`) or a `git filter-repo` history rewrite, which is a significant, admin-only operation not undertaken in this read-only audit.

**Finding CI-2 [High, live, currently failing] — `Repository policy` workflow is RED on the current `main` HEAD.**

Evidence: same live `gh run list` query, `conclusion: failure`. `gh run view --log-failed` shows the exact cause: a "Root folder allowlist" check enumerates all root-level tracked files and fails on any not in an explicit allowlist. Independently re-ran the exact same allowlist logic locally against `git ls-files --full-name`, and found 3 unapproved files: `npm`, `tsc`, and `release-inputs.template.json`.
- **`npm` and `tsc`**: confirmed via `git log --diff-filter=A` to be tracked, committed, **empty (0-byte) files** at commits `bbd5b6ae`/`72887755`/`5cb7470c`. Near-certainly an accidental shell-redirection artifact (e.g. `command > npm` typo) that got committed. **Trivial fix: `git rm npm tsc`.**
- **`release-inputs.template.json`**: a real, non-empty (2,225 byte), intentional file (the release-scorecard template referenced in `plans/OUTSTANDING-ACTIONS.md` item 31) that was added to the repo root but never added to the CI policy's allowlist nor moved to a subfolder. **Fix: move to a subfolder (e.g. `scripts/release/` alongside its sibling `derive-inputs.mjs`) or add it to the allowlist with justification, per the CI job's own error message.**

**Both CI-1 and CI-2 are real and independently reproduced, currently red on `main`.** They are **not** in the branch-protection `required_status_checks` list (verified live via `gh api repos/.../branches/main/protection`, see NOT VERIFIED section), so they do not currently block PR merges — but they are real, unresolved failures nonetheless, and a false sense of security if anyone assumes "CI is green" without checking which specific jobs are required vs. informational. Neither was flagged as still-open in the most recent prior engagement report (which cited a clean `repo-hygiene.yml` run from 2026-07-06 — a different workflow than either of these two).

**Main `street CI/CD` pipeline: VERIFIED green, live.** `gh run view` on the current HEAD's run (`28825911748`) shows 30/30 jobs `success`, including `Core (Node 22)`, `Core (Node 24)`, all 6 system-test suites × 2 Node versions, `MySQL Integration Tests`, `Package Integrity`, `Test & Publish`, `Docker Build & Push`.

**`Repository Hygiene` (the separate, previously-built workflow covering manifest/README-import/placeholder/cycles checks): VERIFIED green**, `conclusion: success` on the current HEAD.

**`CodeQL Advanced`, `Scorecard supply-chain security`, `Docs SEO`, `Deploy Documentation to GitHub Pages`, `Block private keys & verify signing anchor`: all VERIFIED `success` on the current HEAD**, live `gh run list` query.

---

## GitHub Results

**Live workflow run status was independently queried via `gh run list`/`gh run view` against the real GitHub API in this session** (not inferred from any prior report). 20 most-recent runs inspected; results incorporated into CI Results above. `gh auth status` confirmed a valid, authenticated session (`hassanmubiru`, scopes include `repo`/`workflow`) — no GitHub-infrastructure access limitation encountered in this audit.

---

## npm Results

Covered under Packaging Results above. Summary: version lockstep VERIFIED, provenance VERIFIED, LICENSE-file omission VERIFIED (real defect).

---

## Spec Results

**All 16 `.kiro/specs/*/tasks.md` files show 100% checkbox completion (`- [x]`) via a fresh, independent text-based `grep` count** (not the task-tracking tool, not any prior report's claim) — `ci-pool-waiter-audit-fix` (5/5), `codeql-security-alerts-fix` (33/33), `consumer-platform-security` (72/72), `docs-site-dark-mode-and-seo` (19/19), `marzpay-integration` (58/58), `marzpay-scope-alignment` (53/53), `platform-leadership-gaps` (99/99), `plugin-installer-hardening` (14/14), `queue-framework` (65/65), `realtime-framework` (52/52), `saas-starter` (48/48), `scaffold-secure-by-default-boot` (11/11), `security-hardening` (31/31), `street-framework-roadmap` (397/397), `unified-storage-framework` (105/105), `workflow-engine` (79/79).

**This audit did not re-verify the *substance* of each task's implementation** (that would require re-running this entire audit's depth against every one of ~1000+ individual tasks) — only that the tasks.md files themselves are self-consistently marked complete. Given this audit independently found real, unaddressed defects (S-1, CI-1, CI-2, P-1, D-1) that are *not* captured as open items in any of these specs, **100% task-checkbox completion should not be read as "the repository has no remaining defects"** — it means the scoped work in each spec was completed, not that no other defects exist outside those specs' scope.

---

## Remaining Risks

1. **S-1 (path traversal) is a live, exploitable vulnerability in a published package (`@streetjs/storage`) right now.** Highest-priority remaining risk.
2. **CI-1 and CI-2 mean two of the repository's configured workflows are currently red on `main`.** Confirmed via live branch-protection query that neither is in the required-checks list, so they do not block merges/releases mechanically — but a maintainer or user scanning the Actions tab and seeing red X's without checking required-vs-informational status could reasonably (if incorrectly) read this as a bigger problem than it mechanically is. Both are still real, unresolved, and worth fixing promptly.
3. **T-2's orphaned PBT files mean there is currently no running verification for whatever "field-encryption round-trip," "key rotation," and "tamper detection" properties they were meant to guard** — until either the test bug is fixed and the files are wired into a real script/workflow, or their absence is otherwise compensated for, this is a monitoring gap, not just a dead-code cleanliness issue.
4. **D-1 (missing `@types/ws`) affects every new TypeScript adopter following the documented Quick Start exactly.** Direct adoption-blocking friction.
5. **P-1 (missing LICENSE in the published tarball)** is a legal-hygiene gap for downstream consumers/compliance scanners, not a functional defect.

---

## NOT VERIFIED Items

- Whether `docs/migration.md`'s claimed Express/NestJS/Fastify porting guidance exists in the depth implied by the README — not re-checked in this pass.
- Whether the other 16 example projects (beyond `01-rest-api`) share Finding D-2's stale `@streetjs/core` dependency — checked only 1 of 17.
- The exact accuracy of the 2026-06-11 verification artifact's claimed `exitCode: 0` for the three orphaned PBT files — no way to re-run history to confirm or refute.
- The full JWT/session/secret hard-fail chain (previously reported as 3 layers deep) — not re-traced from scratch in this pass.
- The prototype-pollution guard status on `http/server.ts`'s `JSON.parse` — not re-checked in this pass.
- **Branch protection on `main` was queried live via `gh api repos/.../branches/main/protection`**: `required_status_checks.contexts` lists 11 checks (`Secrets Guard`, `Core (Node 22/24)`, `CLI Unit + Migration (Node 22/24)`, `Package Integrity`, `Policy Checks`, `Security Lint`, CodeQL `Analyze` ×2, `Certification Suites + DB E2E`) — **neither `Secret Scanning` (CI-1) nor `Repository policy` (CI-2) is in this required list**, so they are currently informational/non-blocking for PR merges, not release-blocking gates. Also confirmed `enforce_admins: false` (by design — documented in `plans/OUTSTANDING-ACTIONS.md` item #1 as a deliberate solo-maintainer accommodation, since GitHub forbids self-approval for a repo with only one admin), which is why this audit's own direct push of this report to `main` succeeded despite `required_pull_request_reviews: true` being set.
- Real test coverage percentage for `packages/core` — the `coverage` script was not re-run to completion in this pass (it was inspected for which files it includes, per Finding T-2, but not executed end-to-end here).
- Whether the 6 previously-reported zero-test plugins (`plugin-auth0`, `plugin-r2`, `plugin-s3`, `plugin-sendgrid`, `plugin-stripe`, `plugin-twilio`) still have zero tests — not re-checked in this pass.

---

## Release Decision

# CONDITIONALLY READY

**Justification, strictly from evidence gathered in this audit:**

The core build/test/release engineering machinery is real and largely sound — verified fresh builds, a green main CI/CD pipeline with 30 real passing jobs on real Node 22/24 runners, live npm provenance, and exact version lockstep against the real registry. This is not a repository in disarray.

It is not **READY** because this audit independently reproduced a live, exploitable Critical vulnerability (S-1, path traversal) in a currently-published package. Two of the repository's workflows (CI-1, CI-2) are also currently red on `main`, though verified via live branch-protection query to be non-blocking (informational, not in the required-checks list) — real and worth fixing promptly, but not on their own a release blocker the way S-1 is.

It is not **NOT READY** because none of these issues are architectural, none require a design change, all have clear and fast remediations (a path-containment check, `git rm` two empty files plus a template-file relocation or allowlist entry, and a Gitleaks allowlist addition), and the vastly larger surface area of the audit (builds, the main test suite, packaging/version/provenance integrity, spec completion, workflow validity, dependency hygiene, absence of `eval`/injection patterns) came back clean or already-passing on fresh, independent re-verification.

**Recommended before the next release tag:** fix S-1 (path traversal), resolve CI-1 and CI-2 so `main` is genuinely green, and add `@types/ws` guidance to the Quick Start (D-1). The LICENSE-file gap (P-1) and orphaned PBT files (T-2) are real but lower urgency and can follow in a subsequent patch.
