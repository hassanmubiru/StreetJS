/**
 * Public types for @streetjs/logging.
 *
 * Interface-first: every collaborator (logger, transport, redactor, clock) is
 * described here as an interface so applications can substitute their own
 * implementation and wire everything through dependency injection.
 */

import type { LogLevelName } from './levels.js';

export type { LogLevelName };

/** A JSON-representable value. Log fields are normalized to this shape before writing. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Arbitrary structured fields attached to a log call or bound to a logger. */
export type LogFields = Record<string, unknown>;

/**
 * A fully-assembled, transport-ready log record.
 *
 * `fields` has already been redacted and normalized to JSON-safe values; a
 * transport can serialize it directly without further processing. Reserved
 * keys (`level`, `time`, `name`, `msg`) are provided as dedicated members and
 * are never present inside `fields`.
 */
export interface LogRecord {
  /** Numeric severity (see `LEVELS`). */
  readonly level: number;
  /** Severity name. */
  readonly levelName: LogLevelName;
  /** Milliseconds since the Unix epoch when the record was created. */
  readonly time: number;
  /** Logger name, if one was configured. */
  readonly name?: string;
  /** Human-readable message, if one was supplied. */
  readonly msg?: string;
  /** Redacted, JSON-safe merged bindings + per-call fields. */
  readonly fields: Readonly<Record<string, JsonValue>>;
}

/**
 * A sink for log records. Implement this to send logs anywhere (files,
 * sockets, a collector, a test buffer). `write` must not throw; the logger
 * isolates transport failures, but a well-behaved transport handles its own
 * errors.
 */
export interface Transport {
  /** Stable identifier, useful for diagnostics and multi-transport routing. */
  readonly name: string;
  /** Emit a single record. Called synchronously from the logging call site. */
  write(record: LogRecord): void;
  /** Flush any buffered output. Optional. */
  flush?(): void | Promise<void>;
  /** Release resources (file handles, sockets). Optional. */
  close?(): void | Promise<void>;
}

/** Redacts sensitive values from structured fields before they are written. */
export interface Redactor {
  /**
   * Return a redacted, JSON-safe clone of `fields`. Must not mutate the input
   * and must be safe against circular references.
   */
  redact(fields: LogFields): Record<string, JsonValue>;
}

/** Options controlling automatic secret redaction. */
export interface RedactionOptions {
  /**
   * Case-insensitive key names censored wherever they appear at any depth
   * (e.g. `password`, `authorization`). These are merged with a built-in
   * default set unless `useDefaults` is `false`.
   */
  readonly keys?: readonly string[];
  /**
   * Dotted paths censored at an exact location. A `*` segment matches any
   * single key (e.g. `req.headers.authorization`, `users.*.token`).
   */
  readonly paths?: readonly string[];
  /** Replacement string written in place of a redacted value. Default `"[Redacted]"`. */
  readonly censor?: string;
  /** Merge with the built-in default key set. Default `true`. */
  readonly useDefaults?: boolean;
}

/** A monotonic-ish clock, injectable for deterministic tests. Returns epoch ms. */
export type Clock = () => number;

/** Called when a transport throws. Never called re-entrantly from itself. */
export type TransportErrorHandler = (error: unknown, record: LogRecord) => void;

/** Options for {@link createLogger}. */
export interface LoggerOptions {
  /** Minimum severity to emit. Default `"info"`. */
  readonly level?: LogLevelName;
  /** Logger name, attached to every record and inherited by children. */
  readonly name?: string;
  /** Fields bound to every record produced by this logger and its children. */
  readonly base?: LogFields;
  /** Destination sink. Default a JSON {@link Transport} writing to stdout. */
  readonly transport?: Transport;
  /** Redaction configuration, or a fully custom {@link Redactor}. */
  readonly redact?: RedactionOptions | Redactor;
  /** Time source. Default `Date.now`. */
  readonly clock?: Clock;
  /** Invoked when the transport throws. Default writes a notice to stderr. */
  readonly onError?: TransportErrorHandler;
}

/** Handle returned by {@link Logger.startTimer}. */
export interface Timer {
  /**
   * Log the elapsed time (as `durationMs`) at `info` level. Accepts optional
   * extra fields and/or a message, mirroring the level-method overloads.
   */
  done(fields: LogFields, msg?: string): void;
  done(msg?: string): void;
  /** Elapsed milliseconds so far, without logging. */
  elapsed(): number;
}

/**
 * A structured logger.
 *
 * Level methods accept either a message string, an {@link Error}, or a fields
 * object optionally followed by a message:
 *
 * ```ts
 * log.info('started');
 * log.info({ port: 3000 }, 'listening');
 * log.error(err);
 * log.error({ err, requestId }, 'request failed');
 * ```
 */
export interface Logger {
  /** This logger's current threshold level. */
  readonly level: LogLevelName;
  /** Fields bound to this logger (read-only view). */
  readonly bindings: Readonly<LogFields>;

  trace(fields: LogFields, msg?: string): void;
  trace(msg: string): void;
  trace(err: Error, msg?: string): void;

  debug(fields: LogFields, msg?: string): void;
  debug(msg: string): void;
  debug(err: Error, msg?: string): void;

  info(fields: LogFields, msg?: string): void;
  info(msg: string): void;
  info(err: Error, msg?: string): void;

  warn(fields: LogFields, msg?: string): void;
  warn(msg: string): void;
  warn(err: Error, msg?: string): void;

  error(fields: LogFields, msg?: string): void;
  error(msg: string): void;
  error(err: Error, msg?: string): void;

  fatal(fields: LogFields, msg?: string): void;
  fatal(msg: string): void;
  fatal(err: Error, msg?: string): void;

  /** Emit at an explicit level. Ignored when the level is `silent`. */
  log(level: LogLevelName, fields: LogFields, msg?: string): void;
  log(level: LogLevelName, msg: string): void;

  /** True when a record at `level` would currently be emitted. */
  isLevelEnabled(level: LogLevelName): boolean;
  /** Change this logger's threshold at runtime. Does not affect existing children. */
  setLevel(level: LogLevelName): void;

  /** Create a child logger that inherits everything and adds `bindings`. */
  child(bindings: LogFields): Logger;

  /** Start a duration timer. */
  startTimer(): Timer;

  /** Flush the underlying transport. */
  flush(): Promise<void>;
  /** Close the underlying transport. Subsequent writes are no-ops-safe at the transport. */
  close(): Promise<void>;
}
