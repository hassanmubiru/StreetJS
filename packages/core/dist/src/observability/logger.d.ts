import type { MiddlewareFn } from '../core/types.js';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    correlationId?: string;
    service: string;
    [key: string]: unknown;
}
export declare class Logger {
    private readonly service;
    private readonly minLevel;
    private readonly stream;
    private readonly bindings;
    constructor(opts: {
        service: string;
        level?: LogLevel;
        stream?: NodeJS.WritableStream;
        /** Internal: bindings merged into every log entry. */
        _bindings?: Record<string, unknown>;
    });
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
    child(bindings: Record<string, unknown>): Logger;
    private _write;
    private _writePretty;
}
/**
 * Koa-style middleware that:
 * 1. Extracts or generates a UUID v4 correlation ID from/as `X-Correlation-ID`.
 * 2. Stores it in `ctx.state['correlationId']`.
 * 3. Creates a child logger in `ctx.state['logger']`.
 * 4. Sets the `X-Correlation-ID` response header.
 */
export declare function correlationMiddleware(logger: Logger): MiddlewareFn;
//# sourceMappingURL=logger.d.ts.map