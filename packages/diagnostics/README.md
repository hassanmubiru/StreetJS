# @streetjs/diagnostics

The StreetJS structured diagnostics reporter: turns any thrown value into a
clean, structured `DiagnosticEvent`, emits it on a `'diagnostic'` event, and
writes the JSON line to `process.stderr`. **Zero runtime dependencies**, ESM.

This is the standalone home of the reporter that also backs the `streetjs`
framework. The framework re-exports this package, so there is a single source of
truth.

## Install

```bash
npm install @streetjs/diagnostics
```

## Usage

```ts
import { diagnosticsReporter } from '@streetjs/diagnostics';

// Ship structured diagnostics to your sink of choice.
diagnosticsReporter.on('diagnostic', (event) => {
  metrics.increment('errors', { class: event.errorClass });
});

try {
  doWork();
} catch (err) {
  diagnosticsReporter.report(err, correlationId);
}
```

Use the shared `diagnosticsReporter` singleton, or construct your own
`new DiagnosticsReporter()` (it extends `EventEmitter`).

## The event

`report(err, correlationId?)` produces a `DiagnosticEvent`:

```ts
interface DiagnosticEvent {
  level: 'error' | 'warn';
  errorClass: string;   // constructor name, "StringError", or "UnknownError"
  message: string;
  stack: string[];      // cleaned frames only
  correlationId?: string;
  ts: string;           // ISO 8601
}
```

- **`Error`** → `errorClass` is the constructor name (subclasses preserved),
  `message` is `err.message`, and `stack` is cleaned.
- **`string`** → `errorClass` is `"StringError"`, `message` is the string.
- **anything else** → `errorClass` is `"UnknownError"`, `message` is `String(err)`.

### Stack cleaning

Only real `at …` frames are kept; blank/noise lines and Node-internal frames
(`node:internal`, `node_modules/node`) are stripped, so the stack shows your code
rather than runtime plumbing.

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/diagnostics
```

## License

MIT — see [LICENSE](./LICENSE).
