# @streetjs/logging — Architecture

## Goals

- A single, generic logging foundation every StreetJS package can build on.
- Zero runtime dependencies (Node.js core only), matching the framework's minimal,
  carefully curated footprint.
- Strongly typed, interface-first public API; strict TypeScript; no circular deps.
- Structured output by default; secrets never reach a transport.
- Cheap when disabled: a suppressed level does no field work.

## Module layout

```
src/
  levels.ts      Level names, severities, and lookups (graph root — no imports).
  types.ts       Public interfaces: Logger, Transport, Redactor, LogRecord, options.
  serialize.ts   JSON-safe leaf normalization + robust error serialization.
  redaction.ts   DefaultRedactor: single redacting, circular-safe, normalizing walk.
  transport.ts   Built-in transports (console/stream/memory/multi) + formatters.
  logger.ts      LoggerImpl + createLogger() factory.
  index.ts       Curated public API. Internals are not exported.
```

## Dependency graph (acyclic)

```
levels    ← types, transport, logger
types     ← serialize, redaction, transport, logger
serialize ← redaction
redaction ← logger
transport ← logger
logger    ← index
index     → everything public
```

One direction only. `types.ts` re-exports `LogLevelName` from `levels.ts` so consumers
have a single import surface, but no module imports "sideways" into a peer that also
imports it.

## Emission path

A level call runs the following, in order:

1. **Level check.** If the call's severity is below the logger's threshold (or the
   threshold is `silent`), return immediately — no allocation, no field processing.
2. **Argument parse.** Normalize the `(fields|string|Error, msg?)` overloads into a
   `fields` object and an optional `msg`. An `Error` becomes `{ err }` with `msg`
   defaulting to `error.message`.
3. **Merge.** Shallow-merge the logger's bindings with the per-call fields (per-call
   wins). Bindings are stored raw and merged per emission so runtime changes are seen.
4. **Redact + normalize.** The `Redactor` produces a redacted, JSON-safe clone in a
   single walk (see below).
5. **Assemble.** Build an immutable `LogRecord` with reserved members (`level`,
   `levelName`, `time`, `name`, `msg`) plus `fields`.
6. **Write.** Hand the record to the transport inside a `try/catch`; a throwing
   transport is routed to `onError` and never propagates to the caller.

## The redacting walk

`DefaultRedactor.redact()` performs exactly one traversal that simultaneously:

- **censors by key name** — a case-insensitive set matched at any depth (built-in
  defaults plus user keys),
- **censors by path** — exact dotted paths with `*` wildcard segments,
- **normalizes leaves** — via `serialize` (errors, dates, bigint, typed arrays,
  `toJSON`, functions/symbols → descriptive strings),
- **guards cycles** — a `WeakSet` of visited containers (seeded with the root) turns
  repeats into `"[Circular]"`,
- **bounds depth** — pathological nesting yields `"[Truncated: max depth]"`.

`Map`/`Set` are walked (as object/array) so redaction reaches values inside them. The
input is never mutated; a fresh JSON-safe structure is returned. Values produced by a
custom `toJSON()` are normalized but not key-redacted — a documented boundary.

## Secret handling

Redaction happens before the record is constructed, so a secret value cannot reach any
transport, formatter, or the `onError` notice. The default key set covers common
credential names; applications extend it (or supply a whole `Redactor`) at construction.
The package performs no logging of its own beyond the single-line transport-error notice
on stderr, which contains only the error message and the dropped record's level.

## Typing strategy

Level methods are overloaded to accept a message, an `Error`, or a fields object with an
optional message, giving pino-like ergonomics with strict types. `LogRecord.fields` is
typed as JSON-safe values because normalization has already run. Collaborators
(`Transport`, `Redactor`, `Clock`, `TransportErrorHandler`) are interfaces/function
types, so everything is substitutable and DI-friendly without a container dependency.

## Extension points

- **New sinks** implement `Transport` and are passed via `transport` (or composed with
  `MultiTransport`). No core change required — this is how file rotation, network
  collectors, or platform sinks plug in.
- **Custom redaction** implements `Redactor` (or configures `RedactionOptions`).
- **Deterministic time** via the injectable `Clock` (used throughout the test suite).
- **Downstream StreetJS packages** accept a `Logger` by interface and receive one via
  the `LOGGER` DI token; they depend on `@streetjs/logging`, never the reverse.

## Testing

`node --test` over real behavior with a `MemoryTransport` and a fixed `clock` for
deterministic assertions: level filtering, every argument form, child bindings and
isolation, runtime level changes, timers, transport-failure isolation (custom and
default handlers), redaction (keys/paths/wildcards/defaults/custom censor/circular/
Map/Set/depth), error and value serialization (cause chains, circular `toJSON`, dates,
bigint, typed arrays), and all transports/formatters. Coverage is enforced at ≥90%
(`c8 check-coverage`); the declaration-only `types.ts` is excluded as it emits no
executable code.
