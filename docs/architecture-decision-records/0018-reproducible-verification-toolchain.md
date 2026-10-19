# ADR 0018: Pin the clean-install toolchain and add staged verification

- **Status:** Accepted
- **Date:** 2026-10-20
- **Scope:** root workspace, `@streetjs/cli`, Docker build inputs

## Problem

The root lockfile installed TypeScript 7 for the workspace while CLI test
sources use the TypeScript 5 compiler API. A fresh `npm ci` therefore failed the
root build even though a previously installed dependency tree could build. The
repository also lacked one command that clearly separated build, lint,
typecheck, offline, integration, and external-service checks.

## Decision

- Pin the CLI development TypeScript range to the compiler API it uses
  (`^5.9.3`) while leaving the rest of the workspace unchanged.
- Add `npm run verify`, implemented by `scripts/verify.mjs`, with explicit stage
  labels and a nonzero exit for required-stage failures.
- Mark external-service tests `SKIPPED` unless
  `STREETJS_RUN_EXTERNAL=1` is explicitly set.
- Align repository Docker build images with the supported Node 22 runtime and
  retain pinned image digests.

## Compatibility impact

No application-facing API changes. The CLI compiler pin affects development and
build tooling only. Existing package-local commands remain available.

## Evidence

After `npm ci`, `npm run verify` passes BUILD, LINT, TYPECHECK, core and CLI
OFFLINE TESTS, and INTEGRATION TESTS; EXTERNAL SERVICE TESTS are explicitly
reported as SKIPPED. The root build previously failed under the clean install
before the CLI toolchain pin.
