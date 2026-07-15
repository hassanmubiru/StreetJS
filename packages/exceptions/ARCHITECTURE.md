# Architecture — @streetjs/exceptions

## Purpose

`@streetjs/exceptions` is the lowest tier of the StreetJS backend: a typed HTTP
exception hierarchy that any layer (controllers, middleware, repositories,
transports) can throw and any error handler can serialize. It is deliberately
tiny and has **zero runtime dependencies** so that every other `@streetjs/*`
package can depend on it without pulling in weight.

## Design

### Single base class

```
Error
 └── StreetException            (status, message, details?, toJSON())
      ├── BadRequestException            400
      ├── UnauthorizedException          401
      ├── ForbiddenException             403
      ├── NotFoundException              404
      ├── ConflictException              409
      ├── UnprocessableException         422
      ├── InternalException              500
      ├── FeatureUnavailableInEdgeRuntimeError  501
      ├── ServiceUnavailableException    503
      └── DatabaseConnectionError        503 (adds `suggestion`)
```

`StreetException` extends the native `Error`. It:

- stores an HTTP `status` and optional structured `details`;
- sets `this.name` to the concrete subclass name via `this.constructor.name`, so
  serialized errors self-describe without a manual `name` assignment per class;
- calls `Error.captureStackTrace(this, this.constructor)` to keep the exception
  constructor out of the captured stack;
- implements `toJSON()` returning a stable wire shape
  `{ error, message, status, details? }`.

### Stable JSON contract

`toJSON()` is the contract error middleware relies on. `details` is only
included when defined, and `DatabaseConnectionError` overrides `toJSON()` to
append a `suggestion` field (again, only when set). This keeps payloads minimal
and predictable — a property the tests assert directly.

### Type guard

`isStreetException` is a runtime `instanceof` check exposed as a TypeScript type
guard. It lets a single error handler branch cleanly between framework errors
(safe, client-facing `status` + JSON body) and unexpected errors (collapse to a
generic 500 without leaking internals).

## Relationship to core

The `streetjs` framework's `src/http/exceptions.ts` re-exports this package
verbatim, so the framework and standalone consumers share one implementation.
There is no duplication and no shim: core depends on `@streetjs/exceptions` and
its `prebuild`/`prebuild:app` hooks compile this package first.

## Testing

Pure classes with no I/O, so the suite is exhaustive and runs with zero
services: status/name/JSON per subclass, `details`/`suggestion` inclusion and
omission, the Edge-runtime message format, and the guard against plain errors.
Coverage is 100% across statements, branches, functions, and lines.

## Non-goals

- No transport coupling: this package never touches an HTTP request/response.
- No logging, metrics, or i18n of messages — those belong to higher tiers.
- No provider or vendor specifics.
