# Implementation Plan

## Overview

This plan follows the exploratory bug-condition methodology from the design: first surface
counterexamples that demonstrate each behavioral defect on the **unfixed** code (classes A–D),
capture the **current** behavior for all non-buggy inputs (preservation baseline), then apply each
minimal fix and verify both fix-checking and preservation properties. Classes E (no behavioral
change) and F (structural) are validated by equivalence and presence checks rather than failing
exploration tests. A final task re-runs CodeQL to confirm every targeted alert is resolved.

Property labels below map to the **Correctness Properties** in `design.md` (Properties 1–7) so
hover status tracks the documented properties.

## Tasks

### Phase 1 — Exploratory Bug Condition Checking (write BEFORE any fix)

- [x] 1. Write Class A bug-condition exploration test (TLS validation leak)
  - **Property 1: Bug Condition** - TLS Validation Never Disabled (Class A)
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **GOAL**: Surface a counterexample proving `rejectUnauthorized: false` leaks into the HTTPS options
  - **Scoped approach** (deterministic bug): To make `sendRequest` options unit-testable, extract an
    options-builder (e.g. `buildRequestOptions(target)`) or capture options via an `https.request` spy
  - Build request options for a target satisfying `isBugCondition_A`:
    `{ url:'https://evil.example', tls:{ rejectUnauthorized:false } }`
  - Assert the produced options contain `rejectUnauthorized === false`
  - Run test on UNFIXED code (`packages/core/src/webhook/dispatcher.ts`)
  - **EXPECTED OUTCOME**: Test FAILS the safety assertion (options DO contain `rejectUnauthorized: false`) — this proves the leak exists
  - Document the counterexample (options object carries `rejectUnauthorized: false`)
  - Mark complete when the test is written, run, and the leak is documented
  - _Requirements: 1.1_

- [x] 2. Write Class B bug-condition exploration test (ReDoS / super-linear timing)
  - **Property 2: Bug Condition** - Linear-Time Matching/Parsing (Class B)
  - **CRITICAL**: This property-based / timing test MUST demonstrate super-linear growth on unfixed code
  - **DO NOT attempt to fix the test or the code when it fails**
  - **GOAL**: Surface counterexamples showing quadratic blow-up in the three flagged patterns
  - **Scoped PBT Approach**: Drive adversarial inputs at increasing sizes N and assert against a linear time budget (the assertion FAILS on unfixed code):
    - `base32Decode('='.repeat(N) + 'A')` — `auth/mfa.ts:31` `=+$` backtracking
    - `generateGrpc` basename derivation on an N-char slash-free `--proto` value — `cli/.../generate.ts:126` `.*\/`
    - `parseProto('/*'.repeat(N))` — `grpc/proto-parser.ts:40` `[\s\S]*?\*\/` rescan
  - Run on UNFIXED code
  - **EXPECTED OUTCOME**: Processing time grows ~quadratically with N (exceeds linear budget) — confirms ReDoS
  - Document the timing counterexamples (per-site growth curve)
  - Mark complete when tests are written, run, and the super-linear growth is documented
  - _Requirements: 1.2, 1.3, 1.4_

- [x] 3. Write Class C bug-condition exploration test (incomplete purl encoding)
  - **Property 3: Bug Condition** - Complete purl Encoding (Class C)
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **GOAL**: Surface a counterexample where a special character beyond the first occurrence is left unescaped
  - **Scoped PBT Approach**: For names satisfying `isBugCondition_C` (more than one `@`), e.g.
    `buildPurl('a@b@c', '1.0.0')`, assert the purl contains no unescaped `@`
  - Run on UNFIXED code (`scripts/generate-sbom.mjs:44`, which uses `.replace('@','%40')` — first match only)
  - **EXPECTED OUTCOME**: Test FAILS — purl is `pkg:npm/a%40b@c@1.0.0` (second `@` unescaped)
  - Document the counterexample (residual `@` beyond the first)
  - Mark complete when the test is written, run, and the partial encoding is documented
  - _Requirements: 1.5_

- [x] 4. Write Class D bug-condition exploration test (sanitization reconstitution)
  - **Property 4: Bug Condition** - Sanitization Fixed Point (Class D)
  - **CRITICAL**: This test MUST FAIL on the stale single-pass artifact - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **GOAL**: Surface a counterexample where a single/limited pass leaves a residual dangerous substring
  - **Scoped PBT Approach**: For reconstitutable inputs satisfying `isBugCondition_D`, e.g.
    `'<scr<script>ipt>'` and `'java<>script:'`, assert `sanitizeString(input)` contains no dangerous substring
  - Run against the shipped `dist/security/xss.js` (the file CodeQL flagged) / single-pass behavior
  - **EXPECTED OUTCOME**: Test FAILS — output still contains a dangerous substring (e.g. `javascript:` reconstituted)
  - Document the counterexample (residual dangerous substring after one pass)
  - Mark complete when the test is written, run, and the reconstitution is documented
  - _Requirements: 1.6_

### Phase 2 — Preservation Baseline (write BEFORE any fix)

- [x] 5. Write preservation property/unit tests capturing current behavior (BEFORE implementing fixes)
  - **Property 7: Preservation** - Non-Buggy Inputs Unchanged (all classes)
  - **IMPORTANT**: Follow observation-first methodology — record actual outputs of the UNFIXED code, then assert them
  - **GOAL**: Lock in the baseline so the fixes can be proven to leave non-buggy inputs untouched (`F(X) = F'(X)`)
  - Capture and assert, on UNFIXED code:
    - **A**: targets with no `tls`, `tls.ca` only, or `rejectUnauthorized` true/undefined dispatch, HMAC-SHA256 sign, retry, and enforce SSRF/blocked-address protection (options builder/spy produces no `rejectUnauthorized: false`)
    - **B** (PBT): random valid base32 strings round-trip via `base32Decode` (RFC 4648 + `base32Encode`); valid `--proto` paths derive the same `generateGrpc` filename; existing proto fixtures produce an identical `parseProto` AST
    - **C** (PBT): random names without `@` and standard single-`@` scoped names produce identical purls and identical sorted SBOM `components`
    - **D** (PBT): random benign strings (no dangerous substrings) return identical sanitized output; `MAX_DEPTH`, `MAX_STRING_LEN`, `MAX_ARRAY`, `MAX_KEYS` bounds behave identically
    - **E**: existing `mysql-native-password` / `mysql-caching-sha2-password` known-vector and reference-scramble tests
  - Run all preservation tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this is the baseline behavior to preserve)
  - Mark complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7_

### Phase 3 — Implement Fixes

- [x] 6. Fix Class A — disable the TLS-validation bypass in the webhook dispatcher

  - [x] 6.1 Remove the `rejectUnauthorized: false` spread in `sendRequest`
    - Edit `packages/core/src/webhook/dispatcher.ts`: delete the
      `...(tls?.rejectUnauthorized === false ? { rejectUnauthorized: false } : {})` spread so validation is never disabled
    - Retain the custom-CA path `...(tls?.ca ? { ca: tls.ca } : {})` as the supported private-CA mechanism
    - Update the `WebhookTarget.tls` JSDoc to state `rejectUnauthorized` can no longer disable validation and that `tls.ca` is the supported path for private CAs
    - _Bug_Condition: isBugCondition_A(target) — target.tls != null AND target.tls.rejectUnauthorized === false_
    - _Expected_Behavior: buildRequestOptions'(target).rejectUnauthorized != false (validation always enabled)_
    - _Preservation: targets without tls / rejectUnauthorized true|undefined already produced `{}` for this spread — unchanged_
    - _Requirements: 2.1, 3.1_

  - [x] 6.2 Verify Class A exploration test now passes
    - **Property 1: Expected Behavior** - TLS Validation Never Disabled (Class A)
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - **EXPECTED OUTCOME**: Test PASSES (options never contain `rejectUnauthorized: false`)
    - _Requirements: 2.1_

  - [x] 6.3 Verify Class A preservation still holds
    - **Property 7: Preservation** - Normal Dispatch Preserved (Class A)
    - Re-run the Class A preservation assertions from task 5
    - **EXPECTED OUTCOME**: Normal HTTPS dispatch, signing, retries, and SSRF protection unchanged
    - _Requirements: 3.1_

- [x] 7. Fix Class B — replace polynomial regexes with linear-time equivalents

  - [x] 7.1 B.1 — `base32Decode` linear trailing-`=` trim (`packages/core/src/auth/mfa.ts:31`)
    - Replace `input.toUpperCase().replace(/=+$/g,'').replace(/\s/g,'')` with the uppercase + linear
      trailing-`=` `while` trim + `.replace(/\s/g,'')` from the design (identical output/eval order)
    - _Bug_Condition: isBugCondition_B(input) — every input reaches the flagged pattern_
    - _Expected_Behavior: matchTime'(input) is O(n) AND result'(input) === result(input) for well-formed input_
    - _Preservation: valid base32 decodes identically; malformed input still throws on first invalid char_
    - _Requirements: 2.2, 3.2_

  - [x] 7.2 B.2 — `generateGrpc` basename via `node:path` (`packages/cli/src/commands/generate.ts:126`)
    - Add `basename` to the existing `node:path` import; replace `protoPath.replace(/.*\//,'').replace(/\.proto$/,'')`
      with `basename(protoPath).replace(/\.proto$/,'')`
    - _Bug_Condition: isBugCondition_B(input) — uncontrolled `--proto` path reaches the flagged pattern_
    - _Expected_Behavior: linear basename derivation; identical filename for valid POSIX `--proto` paths_
    - _Preservation: same generated gRPC filename/types for valid inputs_
    - _Requirements: 2.3, 3.2_

  - [x] 7.3 B.3 — `stripComments` single-pass linear scanner (`packages/core/src/microservices/grpc/proto-parser.ts:40`)
    - Replace the regex-based comment removal with the O(n) single-pass scanner from the design
      (block `/* … */` to first `*/`; line `// …` to end-of-line)
    - _Bug_Condition: isBugCondition_B(input) — uncontrolled `.proto` source reaches the flagged pattern_
    - _Expected_Behavior: linear comment strip; identical output for well-formed `.proto` source_
    - _Preservation: parseProto produces an identical AST for existing proto fixtures_
    - _Requirements: 2.4, 3.2_

  - [x] 7.4 Verify Class B exploration test now passes
    - **Property 2: Expected Behavior** - Linear-Time Matching/Parsing (Class B)
    - **IMPORTANT**: Re-run the SAME adversarial timing tests from task 2 — do NOT write new tests
    - **EXPECTED OUTCOME**: Processing completes within the linear time budget at all N (no super-linear growth)
    - _Requirements: 2.2, 2.3, 2.4_

  - [x] 7.5 Verify Class B preservation still holds
    - **Property 7: Preservation** - Well-Formed Equivalence (Class B)
    - Re-run the Class B equivalence PBT/unit tests from task 5
    - **EXPECTED OUTCOME**: base32 round-trip, `generateGrpc` filename, and `parseProto` AST all unchanged
    - _Requirements: 3.2_

- [x] 8. Fix Class C — global `@` replacement in the SBOM purl

  - [x] 8.1 Use a global regex replacement in `scripts/generate-sbom.mjs:44`
    - Replace `dp.name.replace('@','%40')` with `dp.name.replace(/@/g,'%40')` so every `@` is encoded
      (the `bom-ref` derives from the same purl and stays consistent)
    - _Bug_Condition: isBugCondition_C(name) — name contains a character requiring escaping beyond the first occurrence_
    - _Expected_Behavior: buildPurl'(name) contains no unescaped special character_
    - _Preservation: names with no `@` and standard single-`@` scoped names produce byte-identical purls/SBOM_
    - _Requirements: 2.5, 3.3_

  - [x] 8.2 Verify Class C exploration test now passes
    - **Property 3: Expected Behavior** - Complete purl Encoding (Class C)
    - **IMPORTANT**: Re-run the SAME test from task 3 — do NOT write a new test
    - **EXPECTED OUTCOME**: `buildPurl('a@b@c', …)` yields `…a%40b%40c…` (no unescaped `@`)
    - _Requirements: 2.5_

  - [x] 8.3 Verify Class C preservation still holds
    - **Property 7: Preservation** - No-Special-Char purls (Class C)
    - Re-run the Class C preservation PBT from task 5
    - **EXPECTED OUTCOME**: purls and sorted SBOM `components` unchanged for non-`@` / single-`@` names
    - _Requirements: 3.3_

- [ ] 9. Fix Class D — drive `sanitizeString` to a fixed point and rebuild `dist`

  - [x] 9.1 Loop replacements until stable in `packages/core/src/security/xss.ts`
    - Replace the capped (`MAX_SANITIZE_PASSES`) loop with the `do { … } while (current !== previous)`
      fixed-point loop from the design (each pass only deletes chars, so it terminates)
    - Leave `MAX_DEPTH`, `MAX_STRING_LEN`, `MAX_ARRAY`, `MAX_KEYS` bounds untouched
    - _Bug_Condition: isBugCondition_D(input) — sanitizeOnce(input) still contains a dangerous substring_
    - _Expected_Behavior: sanitizeString'(input) contains no dangerous substring AND is idempotent (f(f(x))===f(x))_
    - _Preservation: benign input returns identically after the first pass; all bounds unchanged_
    - _Requirements: 2.6, 3.4_

  - [x] 9.2 Rebuild the shipped artifact
    - Run `npm run build -w packages/core` so `dist/security/xss.js` (the flagged file) is regenerated from corrected source
    - _Requirements: 2.6_

  - [~] 9.3 Verify Class D exploration test now passes
    - **Property 4: Expected Behavior** - Sanitization Fixed Point (Class D)
    - **IMPORTANT**: Re-run the SAME test from task 4 (against the rebuilt artifact) — do NOT write a new test
    - **EXPECTED OUTCOME**: output contains no dangerous substring and `sanitizeString'(out) === out` (idempotent)
    - _Requirements: 2.6_

  - [~] 9.4 Verify Class D preservation still holds
    - **Property 7: Preservation** - Benign Equivalence + Bounds (Class D)
    - Re-run the Class D preservation PBT from task 5
    - **EXPECTED OUTCOME**: benign sanitized output and depth/length/array/key bounds unchanged
    - _Requirements: 3.4_

- [ ] 10. Resolve Class E — documented CodeQL suppression for protocol-mandated hashing (NO behavioral change)

  - [~] 10.1 Add inline suppression + rationale at the flagged MySQL call sites
    - Confirm the exact rule id from the alert/SARIF (e.g. `js/insufficient-password-hash`)
    - Add the documented `// codeql[<rule-id>] -- …` justification comment above:
      - `createHash('sha1')` in `nativePasswordHash` (`packages/core/src/database/mysql/wire.ts:84`)
      - `createHash('sha256')` in `sha2PasswordHash` (`packages/core/src/database/mysql/wire.ts:112`)
      - the `createHash('sha1')` site in `packages/core/src/tests/mysql-native-password.test.ts`
      - the `createHash('sha256')` site in `packages/core/src/tests/mysql-caching-sha2-password.test.ts`
    - Rationale: protocol-mandated wire-protocol challenge-response, not at-rest password storage; algorithm fixed by MySQL protocol
    - **Fallback**: if inline suppression is not honored, add `.github/codeql/codeql-config.yml` with a
      `query-filters` exclusion scoped to the rule + these paths and reference it from `codeql.yml` via
      `config-file` on `github/codeql-action/init`. No hash output changes under any option.
    - _Bug_Condition: isBugCondition_E(callSite) — SHA1/SHA256 use implements the MySQL wire-protocol challenge-response_
    - _Expected_Behavior: hashOutput'(callSite) === hashOutput(callSite) AND alert resolved via documented suppression_
    - _Preservation: byte-identical hash output; protocol coverage of the tests unchanged_
    - _Requirements: 2.7, 2.8, 3.5_

  - [~] 10.2 Verify Class E equivalence and protocol tests
    - **Property 5: Equivalence** - Resolved Without Behavioral Change (Class E)
    - Run the existing `mysql-native-password` / `mysql-caching-sha2-password` known-vector and reference-scramble tests
    - **EXPECTED OUTCOME**: Tests PASS unchanged; `nativePasswordHash('password', SEED)` still equals `c17d6009a5cb47e59f7483fcf05553bbbf7dd0d6`
    - _Requirements: 2.7, 2.8, 3.5_

- [ ] 11. Resolve Class F — add least-privilege `permissions` to seven workflows

  - [~] 11.1 Add a top-level `permissions: { contents: read }` block to each workflow
    - Insert immediately after the `on:` block in: `.github/workflows/vendor-integration.yml`,
      `observability.yml`, `deploy-verify.yml`, `dast.yml`, `browser-compat.yml`,
      `kafka-integration.yml`, `rabbitmq-integration.yml`
    - Leave `codeql.yml` untouched (already declares per-job permissions, out of scope)
    - _Bug_Condition: isBugCondition_F(workflow) — workflow has no top-level `permissions` block_
    - _Expected_Behavior: workflow' declares a top-level `permissions` block scoped to the minimum (contents: read)_
    - _Preservation: every previously-succeeding step still runs; no job fails for lack of token scope_
    - _Requirements: 2.9, 3.6_

  - [~] 11.2 Verify Class F structural property and step preservation
    - **Property 6: Structural** - Explicit Least-Privilege Permissions (Class F)
    - Assert each of the seven workflows now declares a top-level `permissions` block scoped to `contents: read`
    - Validate workflow YAML (lint/parse) and confirm no step relies on broader default token scope
    - **EXPECTED OUTCOME**: all seven declare least-privilege permissions; existing steps still complete
    - _Requirements: 2.9, 3.6_

### Phase 4 — Final Verification

- [~] 12. Full preservation + build/test sweep
  - **Property 7: Preservation** - Non-Buggy Inputs Unchanged (all classes)
  - Re-run the complete task-5 preservation suite plus the package build (`npm run build -w packages/core`) and full unit/PBT/integration tests
  - Include integration checks from the design: self-signed cert is rejected / trusted cert + `tls.ca` succeeds (A); `xssMiddleware` sanitizes nested bodies to a fixed point within bounds (D); MySQL auth handshake passes (E)
  - **EXPECTED OUTCOME**: all preservation tests pass; no regressions across A–F or unrelated modules
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [~] 13. Re-run CodeQL and confirm alerts resolved
  - Re-run CodeQL on the branch after all changes
  - Confirm each targeted alert is resolved: A (#24), B (#26, #20, #19), C (#25), D (#7, #6), E (#4, #3, #18, #17, #16, #15), F (#30, #29, #28, #27, #23, #22, #21)
  - Confirm no new alerts are introduced
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

- [~] 14. Checkpoint — ensure all tests pass
  - Ensure all exploration (now-passing), preservation, unit, PBT, and integration tests pass and CodeQL is clean
  - Ask the user if questions arise.

## Task Dependency Graph

Waves group tasks that can run in parallel; each wave depends on the prior waves completing.
Wave 1 writes the exploration tests (must FAIL on unfixed code). Wave 2 captures the preservation
baseline (must PASS on unfixed code). Waves 3–4 apply each fix with its verification sub-tasks.
Wave 5 is the full sweep, Wave 6 the CodeQL re-run, Wave 7 the checkpoint.

```json
{
  "waves": [
    {
      "wave": 1,
      "name": "Exploratory bug-condition tests (before fix)",
      "tasks": ["1", "2", "3", "4"],
      "dependsOn": []
    },
    {
      "wave": 2,
      "name": "Preservation baseline (before fix)",
      "tasks": ["5"],
      "dependsOn": ["1", "2", "3", "4"]
    },
    {
      "wave": 3,
      "name": "Apply fixes A–D and Class E/F resolution",
      "tasks": ["6", "7", "8", "9", "10", "11"],
      "dependsOn": ["5"]
    },
    {
      "wave": 4,
      "name": "Full preservation + build/test sweep",
      "tasks": ["12"],
      "dependsOn": ["6", "7", "8", "9", "10", "11"]
    },
    {
      "wave": 5,
      "name": "CodeQL re-run verification",
      "tasks": ["13"],
      "dependsOn": ["12"]
    },
    {
      "wave": 6,
      "name": "Checkpoint",
      "tasks": ["14"],
      "dependsOn": ["13"]
    }
  ]
}
```

## Notes

- **Ordering is critical**: tasks 1–4 (exploration) and task 5 (preservation baseline) MUST be
  written and run on the UNFIXED code before any fix. Exploration tests are expected to FAIL (this
  confirms each bug); preservation tests are expected to PASS (this is the behavior to protect).
- **Re-run, do not rewrite**: each fix's verification sub-task (6.2, 7.4, 8.2, 9.3) re-runs the
  SAME exploration test authored in Phase 1 — those tests encode the expected behavior and must now
  pass. Preservation sub-tasks (6.3, 7.5, 8.3, 9.4) re-run the task-5 baseline.
- **Class E is a non-behavioral fix**: hash output must remain byte-identical; the only change is a
  documented suppression/justification. There is no failing exploration test for E — it is validated
  by equivalence (Property 5).
- **Class F is structural**: validated by asserting the presence of a least-privilege `permissions`
  block (Property 6); it has no behavioral exploration dependency and can proceed in parallel.
- **Task 9.2 (rebuild `dist`)** must run before 9.3 so verification targets the regenerated artifact
  (`dist/security/xss.js` is the file CodeQL flagged).
- **Property-based testing** is recommended for the string/algorithmic classes (B, C, D) per the
  design's testing strategy; classes A and E rely on unit/integration and known-vector tests.
- **`codeql.yml` is out of scope** for Class F — it already declares per-job permissions.
- Long-running commands (workflow runs, full CodeQL scans) should be executed by you in your own
  terminal; for test runs prefer a single-run invocation rather than watch mode.
