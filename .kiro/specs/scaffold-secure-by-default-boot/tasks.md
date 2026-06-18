# Implementation Plan: Scaffold Secure-by-Default Boot

## Overview

This plan closes the four remaining gaps in the streetJS project generator (`packages/cli/src/commands/create.ts`) so a freshly generated backend is secure-by-default and boots out-of-the-box. Every implementation edit is a surgical change to template strings emitted by the four `render*` methods (`renderMainTs`, `renderEnvExample`, `renderDockerCompose`) — no new files, no runtime-library changes. Two gaps live in `renderMainTs` (consume the computed CORS allowlist; add an unauthenticated-routes notice) and the rest are config-file discoverability fixes (`.env.example`, `docker-compose.yml`). Established behavior (R1–R4, R5.1/5.3/5.4, R6.1) is locked against regression with assertions. Tests extend the existing example-based generator test files; they do not create new ones.

## Tasks

- [ ] 1. Close the CORS and notice gaps in renderMainTs
  - [ ] 1.1 R5.2 — change emitted `app.use(corsMiddleware(['*']));` to `app.use(corsMiddleware(corsOrigins));`
    - Edit the emitted HTTP-server phase line so phase 6 consumes the `corsOrigins` allowlist computed in phase 3
    - Do not alter the existing `corsOrigins` resolver logic; no import changes (`corsMiddleware` already imported)
    - Shared emitted text — single edit covers both the sqlite and postgres variants
    - _Requirements: 5.2_
  - [ ] 1.2 R7 — add an emitted unauthenticated-routes notice above the controller registration block
    - Add a comment immediately above the `registerController(HealthController)` / `registerController(ExampleController)` block
    - The comment must state the example routes are unauthenticated and must be protected before public exposure, referencing `JwtService`/`SessionManager` and `src/middleware/auth.ts`
    - Comment-only; no routing change. Shared emitted text — single edit covers both variants
    - _Requirements: 7.1_

- [ ] 2. Close the discoverability gaps in the emitted config files
  - [ ] 2.1 R6.2 — add `CORS_ORIGINS` to the postgres `.env.example`
    - In `renderEnvExample` postgres branch, add a `CORS_ORIGINS` entry (value emitted empty) after `SESSION_KEY`
    - Use the same explanatory comment already used in the sqlite branch, for parity with R6.1
    - _Requirements: 6.2_
  - [ ] 2.2 R6.3 + R6.4 — add `CORS_ORIGINS` to both docker-compose app env blocks
    - In `renderDockerCompose`, add `CORS_ORIGINS` (emitted empty, with a one-line clarifying comment) to the `app` service `environment:` block in BOTH the sqlite and postgres branches
    - `NODE_ENV: development` in both compose files makes an empty value valid (dev wildcard, not prod fail-fast)
    - _Requirements: 6.3, 6.4_

- [ ] 3. Checkpoint - ensure all tests pass; ask the user if questions arise.

- [ ] 4. Add gap-coverage and regression-lock assertions
  - [ ] 4.1 Gap-coverage assertions (extend existing test files)
    - R5.2: generated `main.ts` contains `corsMiddleware(corsOrigins)` and does NOT contain `corsMiddleware(['*'])` — both variants
    - R7: generated `main.ts` contains the unauthenticated-routes notice — both variants
    - R6.2: generated postgres `.env.example` contains `CORS_ORIGINS`
    - R6.3 / R6.4: both docker-compose variants contain `CORS_ORIGINS` in the `app` environment block
    - Extend the existing example-based tests in `create.test.ts` / `create-database.test.ts` (scaffold to temp dir, read emitted file, assert `.includes`)
    - _Requirements: 5.2, 6.2, 6.3, 6.4, 7.1_
  - [ ] 4.2 Regression-lock assertions (extend existing test files)
    - R1: sqlite `main.ts` contains `CREATE TABLE IF NOT EXISTS items` and the `Database ready (sqlite).` log
    - R2: `main.ts` contains `resolveSecret('JWT_SECRET', 24)` and `resolveSecret('SESSION_KEY', 32)`
    - R4: `example.repository.ts` contains the lazy `get pool()` getter and `ServiceUnavailableException`
    - R6.1: sqlite `.env.example` retains its `CORS_ORIGINS` entry
    - _Requirements: 1.1, 1.2, 1.3, 2.3, 2.4, 4.1, 4.3, 6.1_

- [ ] 5. Verification gate
  - Run `npm run build` then `npm test` in `packages/cli`
  - Require zero failures and zero skips (Rule 8); baseline is 102 + 50 passing tests; surface any breach
  - _Requirements: 1, 2, 4, 5.2, 6, 7_

## Notes

- All implementation edits are confined to the four `render*` methods (`renderMainTs`, `renderEnvExample`, `renderDockerCompose`) in `packages/cli/src/commands/create.ts`.
- The `corsMiddleware` call line (R5.2) and the R7 notice comment are shared emitted text — identical for both the sqlite and postgres variants — so each is a single edit covering both variants.
- Property-based testing is intentionally omitted: the generator emits deterministic template strings keyed on a single discrete parameter (`database` ∈ {sqlite, postgres}), so example-based content assertions across the two variants are the appropriate validation.
- Tests extend the existing test files; no new test files are created.

## Task Dependency Graph

Because all implementation edits write to the same file (`create.ts`) and both test tasks extend the same test files, the same-file rule makes the graph fully sequential — each leaf task is its own wave.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["4.1"] },
    { "id": 5, "tasks": ["4.2"] }
  ]
}
```
