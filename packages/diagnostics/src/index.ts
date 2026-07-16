/**
 * @streetjs/diagnostics — the StreetJS structured diagnostics reporter.
 *
 * `DiagnosticsReporter` turns any thrown value into a clean, structured
 * `DiagnosticEvent` (error class, message, correlation id, ISO timestamp, and a
 * stack with Node-internal frames stripped), emits it on the `'diagnostic'`
 * event, and writes the JSON line to `process.stderr`. Zero runtime
 * dependencies. Public API only.
 *
 * ```ts
 * import { diagnosticsReporter } from '@streetjs/diagnostics';
 *
 * diagnosticsReporter.on('diagnostic', (e) => shipToSink(e));
 * try { risky(); } catch (err) { diagnosticsReporter.report(err, correlationId); }
 * ```
 *
 * > This is the standalone home of the reporter that also backs the `streetjs`
 * > framework; the framework re-exports it, so there is a single implementation.
 */

export { DiagnosticsReporter, diagnosticsReporter } from './reporter.js';
export type { DiagnosticEvent } from './reporter.js';
