# ADR 0010: Make the canonical error envelope opt-in at HTTP boundaries

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** `@streetjs/router`, `streetApp`, and `streetHttp2App`

## Problem

StreetJS now has a canonical error-envelope projection, but changing the default
HTTP response would break clients that consume the existing `{ error, message,
status, details? }` shape.

## Existing behavior

The standalone `errorHandler` serialized `StreetException.toJSON()` and masked
unknown errors as the legacy `InternalException` response. `StreetApp` and HTTP2
called that handler without a response-mode option.

## Decision

Add an opt-in response mode:

```ts
streetApp({ errorResponse: 'envelope' });
```

The standalone handler also accepts:

```ts
errorHandler(ctx, error, { response: 'envelope' });
```

`legacy` remains the default. Envelope mode uses
`toStreetErrorEnvelope()`, preserves the HTTP status, includes an available
correlation ID, and continues reporting unknown errors diagnostically without
exposing their raw details.

## Alternatives considered

1. **Change all HTTP responses immediately:** rejected as a breaking API change.
2. **Add a second error handler implementation:** rejected; the existing handler
   already owns the boundary and can select the representation.
3. **Infer mode from an API version header:** rejected for now; version routing is
   a separate policy and should not silently change error representation.

## Compatibility impact

Default behavior is unchanged. Applications explicitly selecting `envelope` will
receive `{ code, message, status?, details?, correlationId? }` instead of the
legacy response. The option is available for HTTP and HTTP2 application factories.

## Migration path

Applications can enable envelope mode deliberately, update clients, and later
adopt a future major-version default if the ecosystem converges. Existing clients
remain on legacy mode unless the application opts in.

## Evidence

Router tests cover both legacy and envelope modes. Core HTTP integration runs with
envelope mode and verifies code/status. Core build, offline tests, and lint pass.
