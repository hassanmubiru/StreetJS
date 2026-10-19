# ADR 0007: Add an additive canonical error envelope

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** `@streetjs/exceptions` and future framework boundaries

## Problem

StreetJS has useful specialized errors, but transport shapes differ across HTTP,
validation, client, and workflow boundaries. Existing `StreetException.toJSON()`
is already consumed and uses the legacy `{ error, message, status, details? }`
shape. Replacing that shape would be a breaking change.

## Decision

Add `StreetErrorEnvelope` and the pure helper
`toStreetErrorEnvelope(error, correlationId?)` to `@streetjs/exceptions`.

- Recognized `StreetException` values map to `code`, `message`, `status`, optional
  `details`, and optional `correlationId`.
- Unknown errors map to `internal_error` and a generic message without exposing
  raw error data.
- Existing constructors, subclasses, `toJSON()`, `error`, `status`, `details`,
  validation responses, and client/workflow shapes remain unchanged.

Future HTTP/client/workflow integrations must adopt this projection explicitly and
with compatibility tests; this ADR does not silently change response bodies.

## Alternatives considered

1. **Replace `toJSON()` immediately:** rejected because existing tests and users
   consume the legacy shape.
2. **Repurpose `error` as `code`:** rejected because `error` currently mixes class
   names, symbolic values, and labels.
3. **Create a new error package:** rejected; `@streetjs/exceptions` already owns
   the framework error boundary.

## Compatibility impact

Additive only. Existing runtime and wire behavior is unchanged. Unknown errors
remain sanitized when normalized.

## Evidence

Tests cover framework errors, correlation IDs, legacy `toJSON()` preservation,
and sanitization of unknown errors.
