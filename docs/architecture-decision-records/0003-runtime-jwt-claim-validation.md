# ADR 0003: Validate JWT claim shapes at runtime

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** `@streetjs/security` / `streetjs/security`

## Problem

`JwtService.verify()` cryptographically verified a token and then cast the decoded JSON payload to `JwtPayload`. TypeScript's required `sub` field and optional claim types did not validate untrusted runtime JSON. A correctly signed token could therefore contain a missing, empty, or incorrectly typed identity claim.

## Existing behavior

Signature, algorithm, expiry, not-before, issued-at, issuer, and audience checks existed. The payload was parsed with a type assertion. `verify()` returned `null` for malformed or invalid tokens rather than throwing.

## Decision

Keep the existing fail-closed `verify(): JwtPayload | null` API and validate the runtime payload before returning it:

- `sub` is a non-empty string;
- `iat`, `exp`, and `nbf`, when present, are finite numbers;
- `roles`, when present, is an array containing only strings.

The validation remains dependency-free and local to the security package.

## Alternatives considered

1. **Trust TypeScript types:** rejected; JWT payloads are external runtime data.
2. **Add a general schema dependency:** rejected; this package intentionally has zero runtime dependencies and needs only a small fixed validator.
3. **Throw typed verification errors:** rejected for now; existing callers rely on fail-closed `null` behavior.

## Compatibility impact

This is security-hardening behavior. Previously accepted structurally invalid signed tokens now return `null`. Valid tokens are unchanged. The public method signatures and exported types are unchanged.

## Migration path

Applications issuing tokens must provide a non-empty string `sub`, numeric standard time claims, and string role arrays. Invalid tokens should already be handled as authentication failures because `verify()` returns `null`.

## Evidence

Regression tests cover missing/empty/non-string `sub`, invalid numeric claims, and invalid role arrays. The security package build, 29-test suite, and lint pass.
