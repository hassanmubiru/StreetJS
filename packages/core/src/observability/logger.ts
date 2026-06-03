// src/observability/logger.ts
// Structured JSON logger with optional pretty-printing in development,
// child loggers, Error serialization, and correlation middleware.

import * as crypto from 'node:crypto';
import { Injectable } from '../core/container.js';
import type { MiddlewareFn } from '../core/types.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;          // ISO 8601
  level: LogLevel;
  message: string;
  correlationId?: string;
  service: string;
  [key: string]: unknown;
}

// ── Level ordering ────────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info:  1,
  warn:  2,
  error: 3,
};

// ── ANSI colour codes ─────────────────────────────────────────────────────────

const ANSI: Record<LogLevel, string> = {
  debug: '\x1b[36m',   // cyan
  info:  '\x1b[32m',   // green
  warn:  '\x1b[33m',   // yellow
  error: '\x1b[31m',   // red
};
const ANSI_RESET = '\x1b[0m';

// ── Error serialisation helper ────────────────────────────────────────────────

function serializeErrors(
  meta: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v instanceof Error) {
      result[k] = { name: v.name, message: v.message, stack: v.stack };
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ── Logger ────────────────────────────────────────────────────────────────────

@Injectable()
export class Logger {
  private readonly service: string;
  private readonly minLevel: LogLevel;
  private readonly stream: NodeJS.WritableStream;
  private readonly bindings: Record<string, unknown>;

  constructor(opts: {
    service: string;
    level?: LogLevel;
    stream?: NodeJS.WritableStream;
    /** Internal: bindings merged into every log entry. */
    _bindings?: Record<string, unknown>;
  }) {
    this.service   = opts.service;
    this.minLevel  = opts.level ?? 'debug';
    this.stream    = opts.stream ?? process.stderr;
    this.bindings  = opts._bindings ?? {};
  }

  // ── Public log methods ─────────────────────────────────────────────────────

  debug(msg: string, meta?: Record<string, unknown>): void {
    this._write('debug', msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this._write('info', msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this._write('warn', msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this._write('error', msg, meta);
  }

  // ── Child logger ───────────────────────────────────────────────────────────

  child(bindings: Record<string, unknown>): Logger {
    return new Logger({
      service:   this.service,
      level:     this.minLevel,
      stream:    this.stream,
      _bindings: { ...this.bindings, ...bindings },
    });
  }

  // ── Internal write ─────────────────────────────────────────────────────────

  private _write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const serialisedMeta = meta ? serializeErrors(meta) : {};

    const entry: LogEntry = {
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

  private _writePretty(level: LogLevel, entry: LogEntry): void {
    const colour = ANSI[level];
    const { timestamp, message, level: _lvl, service: _svc, ...rest } = entry;
    const metaStr = Object.keys(rest).length > 0 ? '  ' + JSON.stringify(rest) : '';
    const line = `${colour}[${level.toUpperCase()}]${ANSI_RESET} ${timestamp}  ${message}${metaStr}`;
    process.stdout.write(line + '\n');
  }
}

// ── Correlation middleware ────────────────────────────────────────────────────

/**
 * Koa-style middleware that:
 * 1. Extracts or generates a UUID v4 correlation ID from/as `X-Correlation-ID`.
 * 2. Stores it in `ctx.state['correlationId']`.
 * 3. Creates a child logger in `ctx.state['logger']`.
 * 4. Sets the `X-Correlation-ID` response header.
 */
export function correlationMiddleware(logger: Logger): MiddlewareFn {
  return async (ctx, next) => {
    const existing =
      (ctx.headers['x-correlation-id'] as string | undefined) ??
      (ctx.headers['X-Correlation-ID'] as string | undefined);

    const correlationId = existing ?? crypto.randomUUID();

    ctx.state['correlationId'] = correlationId;
    ctx.state['logger'] = logger.child({ correlationId });
    ctx.setHeader('X-Correlation-ID', correlationId);

    await next();
  };
}
