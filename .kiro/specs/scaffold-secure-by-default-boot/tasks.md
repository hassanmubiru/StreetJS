# Implementation Plan: Scaffold Secure-by-Default Boot

## Overview

All work is surgical edits to the template strings emitted by four `render*` methods in `packages/cli/src/commands/create.ts` (`renderMainTs`, `renderEnvExample`, `renderDockerCompose`; `renderExampleRepository` is read-only regression coverage). The four gaps from the design (R5.2, R6.2, R6.3+R6.4, R7) are closed, then locked in with gap-coverage and regression assertions extending the existing example-based generator tests, and finally gated on a clean `npm run build` + `npm test`. No runtime-library code, no new files, no scope expansion.

## Tasks

- [x] 1. Close the CORS and notice gaps in renderMainTs
  - [x] 1.1 R5.2 — change emitted `app.use(corsMiddleware(['*']));` to `app.use(corsMiddleware(corsOrigins));`; do not alter the existing corsOrigins resolver logic; no import changes.
    - _Requirements: 5.2_
  - [x] 1.2 R7 — add an emitted comment immediately above the registerController(HealthController)/registerController(ExampleController) block stating the example routes are unauthenticated and must be protected before public exposure, referencing JwtService/SessionManager and src/middleware/auth.ts; comment-only, no routing change.
    - _Requirements: 7.1_

- [x] 2. Close the discoverability gaps in the emitted config files
  - [x] 2.1 R6.2 — in renderEnvExample postgres branch, add a CORS_ORIGINS entry (value emitted empty) after SESSION_KEY using the same explanatory comment as the sqlite branch.
    - _Requirements: 6.2_
  - [x] 2.2 R6.3 + R6.4 — in renderDockerCompose, add CORS_ORIGINS (emitted empty, with a one-line clarifying comment) to the app service environment block in BOTH sqlite and postgres branches; note NODE_ENV: development makes empty valid.
    - _Requirements: 6.3, 6.4_

- [x] 3. Checkpoint - ensure all tests pass; ask the user if questions arise.

- [x] 4. Add gap-coverage and regression-lock assertions
  - [x] 4.1 Gap-coverage: R5.2 main.ts contains corsMiddleware(corsOrigins) and NOT corsMiddleware(['*']) (both variants); R7 main.ts contains the unauthenticated-routes notice (both variants); R6.2 postgres .env.example contains CORS_ORIGINS; R6.3/6.4 both docker-compose variants contain CORS_ORIGINS in the app env block. Extend existing test files.
    - _Requirements: 5.2, 6.2, 6.3, 6.4, 7.1_
  - [x] 4.2 Regression locks: R1 (items CREATE TABLE IF NOT EXISTS + "Database ready (sqlite)." log), R2 (resolveSecret('JWT_SECRET',24)/('SESSION_KEY',32)), R4 (lazy get pool() + ServiceUnavailableException), R6.1 (sqlite .env.example retains CORS_ORIGINS).
    - _Requirements: 1.1, 1.2, 1.3, 2.3, 2.4, 4.1, 4.3, 6.1_

- [x] 5. Verification gate — run `npm run build` then `npm test` in packages/cli; require zero failures and zero skips (Rule 8); baseline 102 + 50 passing; surface any breach.
  - _Requirements: 1, 2, 4, 5.2, 6, 7_

## Notes

- All implementation edits are confined to the four `render*` methods in `packages/cli/src/commands/create.ts` — no new files, no runtime-library changes.
- The `corsMiddleware(...)` call line (1.1) and the R7 comment (1.2) are shared emitted text — identical for both the sqlite and postgres variants — so each is a single edit covering both variants.
- Tests follow the existing example-based generator pattern (scaffold to temp dir, read emitted file, assert `.includes`); assertions extend `create.test.ts` and `create-database.test.ts` rather than adding new test files.
- Property-based testing is intentionally omitted: the generator emits deterministic template strings keyed on a single discrete `database` parameter, so there is no universal-input property to exercise. Example-based content assertions are the right fit.
- Each task references specific requirements for traceability; the checkpoint and final gate ensure incremental and whole-suite validation.

## Task Dependency Graph

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
