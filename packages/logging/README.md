# @streetjs/logging

The logging foundation for StreetJS: **fast, structured, level-based** logging with
child loggers, bound context, pluggable transports, automatic secret redaction, safe
serialization of errors and circular structures, and timers.

**Zero runtime dependencies.** Built on Node.js core only, matching the StreetJS
minimal, carefully curated dependency footprint. Generic and reusable by any
application — not tied to any particular StreetJS package.

```bash
npm install @streetjs/logging
```

## Why

Every StreetJS package (runtime-http, auth, database, jobs, metrics, …) and every
application needs the same thing: emit structured, level-filtered records; attach
request/context fields without threading them through every call; never leak secrets
into logs; and serialize errors reliably. `@streetjs/logging` provides exactly that,
once, behind small interfaces so any transport or redaction strategy can be plugged
in without changing call sites.

## Quick start

```ts
import { createLogger } from '@streetjs/logging';

const log = createLogger({ name: 'api', level: 'info' });

log.info('service starting');
log.info({ port: 3000 }, 'listening');          // fields + message
log.warn({ retries: 3 }, 'upstream slow');

const reqLog = log.child({ requestId: 'req-abc' }); // bound context
reqLog.debug('handling request');                   // suppressed at info level

try {
  doWork();
} catch (err) {
  reqLog.error({ err }, 'request failed');        // error serialized with stack + cause
}
```

Every record is a single JSON line on stdout by default:

```json
{"level":30,"levelName":"info","time":1717000000000,"name":"api","msg":"listening","port":3000}
```

## Call styles

Each level method (`trace` `debug` `info` `warn` `error` `fatal`) accepts:

```ts
log.info('just a message');
log.info({ userId: 7 }, 'with fields and a message');
log.info({ userId: 7 });                 // fields only, no message
log.error(new Error('boom'));            // error → { err }, msg defaults to error.message
log.error(new Error('boom'), 'context'); // error + explicit message
log.log('warn', { code: 1 }, 'explicit level');
```

## Levels

| Level | Severity | |
|---|---|---|
| `trace` | 10 | most verbose |
| `debug` | 20 | |
| `info` | 30 | default threshold |
| `warn` | 40 | |
| `error` | 50 | |
| `fatal` | 60 | |
| `silent` | 100 | disables all output |

A record is emitted when its severity is **≥** the logger's threshold. Setting a
logger to `silent` disables everything, including `fatal`.

```ts
log.setLevel('debug');          // change threshold at runtime
log.isLevelEnabled('trace');    // false at debug
```

`setLevel` affects only that logger — existing children keep their own threshold.

## Child loggers & bound context

```ts
const base = createLogger({ name: 'worker', base: { service: 'ingest' } });
const jobLog = base.child({ jobId: 42 });
jobLog.info('started');   // includes service + jobId on every line
```

Bindings merge shallowly (`base` → parent → child → per-call fields), later values
winning. Children never mutate their parent.

## Secret redaction

Secret values are censored **before** they reach any transport, so they never appear
in output. Redaction runs on a single walk that also normalizes values to JSON-safe
form and is safe against circular references.

```ts
log.info({ password: 'hunter2', authorization: 'Bearer x' }, 'login');
// → {"...","password":"[Redacted]","authorization":"[Redacted]","msg":"login"}
```

A built-in, case-insensitive key set covers common secret names (`password`, `token`,
`authorization`, `apiKey`, `cookie`, `clientSecret`, …). Extend or replace it:

```ts
createLogger({
  redact: {
    keys: ['ssn', 'creditCard'],           // added to defaults (any depth)
    paths: ['req.headers.authorization',    // exact dotted path
            'users.*.card'],                // `*` matches any one segment
    censor: '***',                          // default '[Redacted]'
    useDefaults: true,                       // set false to drop the built-in set
  },
});
```

For full control, pass any object implementing `Redactor` (`{ redact(fields) }`).

## Transports

A transport is a sink: `{ name, write(record), flush?(), close?() }`. Built-ins:

```ts
import {
  ConsoleTransport, StreamTransport, MemoryTransport, MultiTransport,
} from '@streetjs/logging';

// JSON to stdout (default), or pretty for local dev:
createLogger({ transport: new ConsoleTransport({ format: 'pretty', colors: true }) });

// Route error+ to stderr, everything else to stdout:
new ConsoleTransport({ stderrLevel: 'error' });

// JSON lines to any writable stream (file, socket):
new StreamTransport(fs.createWriteStream('app.log'));

// Capture records for assertions in tests:
const mem = new MemoryTransport();
createLogger({ transport: mem }).info({ a: 1 }, 'hi');
mem.last();            // the last LogRecord
mem.recordsAt('info'); // filter by level

// Fan out to several sinks (failures isolated per sink):
new MultiTransport([new ConsoleTransport(), new StreamTransport(stream)]);
```

Write your own by implementing `Transport`. A transport that throws does not crash the
caller — the error is routed to the `onError` handler (default: a one-line notice on
stderr).

## Error & value serialization

- **Errors** serialize to `{ type, message, stack, …ownProps, cause? }`, following the
  `cause` chain.
- **Circular references** become `"[Circular]"`; deeply nested structures are bounded.
- **`Date`** → ISO string, **`BigInt`** → string, **typed arrays** → `"[Uint8Array: N bytes]"`,
  objects with `toJSON()` use it. Output is always JSON-safe.

## Timers

```ts
const timer = log.startTimer();
await work();
timer.done({ job: 'sync' }, 'completed'); // logs at info with durationMs
timer.elapsed();                           // ms so far, without logging
```

## Dependency injection

This package depends on no container, so it stays a clean foundation. It exports a
`LOGGER` token (a global `Symbol`) for interface-first wiring:

```ts
import { LOGGER, createLogger, type Logger } from '@streetjs/logging';

container.register(LOGGER, createLogger({ name: 'app' }));

class UserService {
  constructor(private readonly log: Logger) {}
}
const svc = new UserService(container.resolve<Logger>(LOGGER));
```

Because collaborators are interfaces (`Logger`, `Transport`, `Redactor`, `Clock`), you
can substitute a `MemoryTransport` and a fixed `clock` in tests for fully deterministic
assertions.

## Public API

`createLogger()` · `Logger` (`trace`/`debug`/`info`/`warn`/`error`/`fatal` · `log` ·
`child` · `setLevel` · `isLevelEnabled` · `startTimer` · `flush` · `close`) ·
transports (`ConsoleTransport`, `StreamTransport`, `MemoryTransport`, `MultiTransport`) ·
`DefaultRedactor` / `createRedactor` / `DEFAULT_REDACT_KEYS` · `serializeError` ·
`LEVELS` / `severityOf` / `levelNameOf` / `isLevelName` · `LOGGER` token · formatters
(`formatJsonLine`, `formatPrettyLine`, `toWireObject`).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module layout and design notes, and
`src/examples/integration.ts` for a runnable end-to-end example.

## License

MIT © street contributors
