import { EventEmitter } from 'node:events';
export interface DiagnosticEvent {
    level: 'error' | 'warn';
    errorClass: string;
    message: string;
    stack: string[];
    correlationId?: string;
    ts: string;
}
export declare class DiagnosticsReporter extends EventEmitter {
    /**
     * Serialize `err` as a structured {@link DiagnosticEvent}, emit the `'diagnostic'`
     * event, and write the JSON to `process.stderr`.
     */
    report(err: unknown, correlationId?: string): void;
    private _buildEvent;
    private _cleanStack;
}
/** Default singleton reporter */
export declare const diagnosticsReporter: DiagnosticsReporter;
//# sourceMappingURL=reporter.d.ts.map