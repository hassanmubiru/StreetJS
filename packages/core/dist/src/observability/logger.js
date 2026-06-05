// src/observability/logger.ts
// Structured JSON logger with optional pretty-printing in development,
// child loggers, Error serialization, and correlation middleware.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var Logger_1;
import * as crypto from 'node:crypto';
import { Injectable } from '../core/container.js';
// ── Level ordering ────────────────────────────────────────────────────────────
const LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
// ── ANSI colour codes ─────────────────────────────────────────────────────────
const ANSI = {
    debug: '\x1b[36m', // cyan
    info: '\x1b[32m', // green
    warn: '\x1b[33m', // yellow
    error: '\x1b[31m', // red
};
const ANSI_RESET = '\x1b[0m';
// ── Error serialisation helper ────────────────────────────────────────────────
function serializeErrors(meta) {
    const result = {};
    for (const [k, v] of Object.entries(meta)) {
        if (v instanceof Error) {
            result[k] = { name: v.name, message: v.message, stack: v.stack };
        }
        else {
            result[k] = v;
        }
    }
    return result;
}
// ── Logger ────────────────────────────────────────────────────────────────────
let Logger = Logger_1 = class Logger {
    service;
    minLevel;
    stream;
    bindings;
    constructor(opts) {
        this.service = opts.service;
        this.minLevel = opts.level ?? 'debug';
        this.stream = opts.stream ?? process.stderr;
        this.bindings = opts._bindings ?? {};
    }
    // ── Public log methods ─────────────────────────────────────────────────────
    debug(msg, meta) {
        this._write('debug', msg, meta);
    }
    info(msg, meta) {
        this._write('info', msg, meta);
    }
    warn(msg, meta) {
        this._write('warn', msg, meta);
    }
    error(msg, meta) {
        this._write('error', msg, meta);
    }
    // ── Child logger ───────────────────────────────────────────────────────────
    child(bindings) {
        return new Logger_1({
            service: this.service,
            level: this.minLevel,
            stream: this.stream,
            _bindings: { ...this.bindings, ...bindings },
        });
    }
    // ── Internal write ─────────────────────────────────────────────────────────
    _write(level, message, meta) {
        if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel])
            return;
        const serialisedMeta = meta ? serializeErrors(meta) : {};
        const isCloudRun = Boolean(process.env['K_SERVICE']);
        if (isCloudRun) {
            // GCP structured logging format for Cloud Run
            const gcpEntry = {
                severity: level === 'error' ? 'ERROR' : level === 'warn' ? 'WARNING' : level === 'info' ? 'INFO' : 'DEBUG',
                message,
                service: this.service,
                ...this.bindings,
                ...serialisedMeta,
                timestamp: new Date().toISOString(),
            };
            this.stream.write(JSON.stringify(gcpEntry) + '\n');
        }
        else {
            const entry = {
                timestamp: new Date().toISOString(),
                level,
                message,
                service: this.service,
                ...this.bindings,
                ...serialisedMeta,
            };
            this.stream.write(JSON.stringify(entry) + '\n');
            if (process.env['NODE_ENV'] === 'development') {
                this._writePretty(level, entry);
            }
        }
    }
    _writePretty(level, entry) {
        const colour = ANSI[level];
        const { timestamp, message, level: _lvl, service: _svc, ...rest } = entry;
        const metaStr = Object.keys(rest).length > 0 ? '  ' + JSON.stringify(rest) : '';
        const line = `${colour}[${level.toUpperCase()}]${ANSI_RESET} ${timestamp}  ${message}${metaStr}`;
        process.stdout.write(line + '\n');
    }
};
Logger = Logger_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Object])
], Logger);
export { Logger };
// ── Correlation middleware ────────────────────────────────────────────────────
/**
 * Koa-style middleware that:
 * 1. Extracts or generates a UUID v4 correlation ID from/as `X-Correlation-ID`.
 * 2. Stores it in `ctx.state['correlationId']`.
 * 3. Creates a child logger in `ctx.state['logger']`.
 * 4. Sets the `X-Correlation-ID` response header.
 */
export function correlationMiddleware(logger) {
    return async (ctx, next) => {
        const existing = ctx.headers['x-correlation-id'] ??
            ctx.headers['X-Correlation-ID'];
        const correlationId = existing ?? crypto.randomUUID();
        ctx.state['correlationId'] = correlationId;
        ctx.state['logger'] = logger.child({ correlationId });
        ctx.setHeader('X-Correlation-ID', correlationId);
        await next();
    };
}
//# sourceMappingURL=logger.js.map