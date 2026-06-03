// src/diagnostics/reporter.ts
// Structured diagnostic reporter: serialises errors to JSON on stderr and emits events.

import { EventEmitter } from 'node:events';

export interface DiagnosticEvent {
  level: 'error' | 'warn';
  errorClass: string;
  message: string;
  stack: string[];       // cleaned frames only (no node:internal or node_modules/node)
  correlationId?: string;
  ts: string;            // ISO 8601
}

/** Regex matching Node.js internal frames that should be stripped from stacks */
const INTERNAL_FRAME_RE = /node:internal|node_modules\/node/;

export class DiagnosticsReporter extends EventEmitter {
  /**
   * Serialize `err` as a structured {@link DiagnosticEvent}, emit the `'diagnostic'`
   * event, and write the JSON to `process.stderr`.
   */
  report(err: unknown, correlationId?: string): void {
    const event = this._buildEvent(err, correlationId);
    this.emit('diagnostic', event);
    process.stderr.write(JSON.stringify(event) + '\n');
  }

  private _buildEvent(err: unknown, correlationId?: string): DiagnosticEvent {
    let errorClass = 'UnknownError';
    let message = String(err);
    let rawStack: string | undefined;

    if (err instanceof Error) {
      errorClass = err.constructor?.name ?? 'Error';
      message = err.message;
      rawStack = err.stack;
    } else if (typeof err === 'string') {
      errorClass = 'StringError';
      message = err;
    }

    const stack = this._cleanStack(rawStack);

    const event: DiagnosticEvent = {
      level: 'error',
      errorClass,
      message,
      stack,
      ts: new Date().toISOString(),
    };

    if (correlationId !== undefined) {
      event.correlationId = correlationId;
    }

    return event;
  }

  private _cleanStack(rawStack: string | undefined): string[] {
    if (!rawStack) return [];
    return rawStack
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('at ') && !INTERNAL_FRAME_RE.test(line));
  }
}

/** Default singleton reporter */
export const diagnosticsReporter = new DiagnosticsReporter();
