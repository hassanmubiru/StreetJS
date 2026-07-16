// src/diagnostics/reporter.ts
// Structured diagnostic reporter: serialises errors to JSON on stderr and emits events.
//
// The implementation now lives in the standalone, zero-dependency
// `@streetjs/diagnostics` package. This module re-exports it verbatim so every
// internal `../diagnostics/reporter.js` importer and the public `streetjs` API
// keep working against a single source of truth — no duplication, no shim.

export { DiagnosticsReporter, diagnosticsReporter } from '@streetjs/diagnostics';
export type { DiagnosticEvent } from '@streetjs/diagnostics';
