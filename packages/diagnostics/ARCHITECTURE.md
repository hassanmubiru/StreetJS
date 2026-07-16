# Architecture — @streetjs/diagnostics

## Purpose

`@streetjs/diagnostics` is the framework's structured error-reporting primitive.
It converts arbitrary thrown values into a stable `DiagnosticEvent` and fans them
out two ways — an in-process event and a JSON line on stderr — so higher layers
(the router, HTTP server, and application error handlers) get consistent,
machine-readable diagnostics without each re-implementing serialization.

## Dependencies

```
node:events   (EventEmitter — base class)
```

Zero third-party runtime dependencies; Node core only.

## Design

### EventEmitter base

`DiagnosticsReporter extends EventEmitter`, so any number of subscribers can
listen for `'diagnostic'` events (to forward to a metrics system, log aggregator,
etc.). A shared `diagnosticsReporter` singleton is exported for the common case,
while callers that need isolation can construct their own.

### Normalization

`report(err, correlationId?)` classifies the input:

- `Error` → `errorClass` from the constructor name (falling back to `'Error'`),
  `message` from `err.message`, stack from `err.stack`.
- `string` → `'StringError'` with the string as the message.
- anything else → `'UnknownError'` with `String(err)` as the message.

The `correlationId` is included only when provided, keeping events minimal.

### Stack cleaning

`_cleanStack` trims each line, keeps only frames beginning with `at `, and drops
frames matching `node:internal` or `node_modules/node`. This yields a stack that
points at application code rather than runtime internals — the same cleaning the
framework relied on before extraction.

### Dual sink

Each `report` both `emit`s the event (for programmatic subscribers) and writes
`JSON.stringify(event) + '\n'` to `process.stderr` (for log capture), so
diagnostics are never silently lost even if nobody is listening.

## Testing

The suite stubs `process.stderr.write` to capture output without polluting the
test runner, and subscribes to `'diagnostic'` to assert the emitted shape. It
covers Error/string/unknown classification, subclass name preservation,
correlation-id inclusion/omission, stack cleaning (kept vs. stripped frames), the
no-stack case, and the stderr JSON line. Coverage is 100% lines/functions and
≥92% branches.

## Non-goals

- No log levels beyond `error`/`warn` in the event shape, and no `warn` helper
  (callers set `level` needs are met by `report`, which emits `error`).
- No transport/formatting configuration — subscribers decide what to do with
  events; the stderr JSON line is fixed.
- No sampling, batching, or async shipping.
