/**
 * The Logger implementation and the `createLogger` factory.
 *
 * Emission path per call:
 *   parse args -> level check -> merge bindings + fields -> redact/normalize
 *   -> assemble LogRecord -> transport.write (failures isolated via onError).
 *
 * Depends on `types`, `levels`, `redaction`, and `transport`.
 */

import type {
  Clock,
  LogFields,
  Logger,
  LoggerOptions,
  LogRecord,
  Redactor,
  Timer,
  Transport,
  TransportErrorHandler,
} from './types.js';
import { LEVELS, severityOf, type LogLevelName } from './levels.js';
import { createRedactor } from './redaction.js';
import { ConsoleTransport } from './transport.js';

const SILENT = LEVELS.silent;

interface LoggerState {
  name?: string;
  bindings: LogFields;
  transport: Transport;
  redactor: Redactor;
  clock: Clock;
  onError: TransportErrorHandler;
}

function defaultOnError(error: unknown, record: LogRecord): void {
  try {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[streetjs/logging] transport error: ${message} (dropped ${record.levelName} record)\n`,
    );
  } catch {
    /* last-resort: never throw from the logger */
  }
}

class LoggerImpl implements Logger {
  private threshold: number;
  private levelName: LogLevelName;
  private readonly state: LoggerState;

  constructor(level: LogLevelName, state: LoggerState) {
    this.levelName = level;
    this.threshold = severityOf(level);
    this.state = state;
  }

  get level(): LogLevelName {
    return this.levelName;
  }

  get bindings(): Readonly<LogFields> {
    return this.state.bindings;
  }

  trace(arg1: LogFields | string | Error, arg2?: string): void {
    this.emit(LEVELS.trace, 'trace', arg1, arg2);
  }

  debug(arg1: LogFields | string | Error, arg2?: string): void {
    this.emit(LEVELS.debug, 'debug', arg1, arg2);
  }

  info(arg1: LogFields | string | Error, arg2?: string): void {
    this.emit(LEVELS.info, 'info', arg1, arg2);
  }

  warn(arg1: LogFields | string | Error, arg2?: string): void {
    this.emit(LEVELS.warn, 'warn', arg1, arg2);
  }

  error(arg1: LogFields | string | Error, arg2?: string): void {
    this.emit(LEVELS.error, 'error', arg1, arg2);
  }

  fatal(arg1: LogFields | string | Error, arg2?: string): void {
    this.emit(LEVELS.fatal, 'fatal', arg1, arg2);
  }

  log(level: LogLevelName, arg1: LogFields | string, arg2?: string): void {
    if (level === 'silent') {
      return;
    }
    this.emit(severityOf(level), level, arg1, arg2);
  }

  isLevelEnabled(level: LogLevelName): boolean {
    const severity = severityOf(level);
    return severity < SILENT && severity >= this.threshold;
  }

  setLevel(level: LogLevelName): void {
    this.levelName = level;
    this.threshold = severityOf(level);
  }

  child(bindings: LogFields): Logger {
    const merged: LogFields = { ...this.state.bindings, ...bindings };
    return new LoggerImpl(this.levelName, { ...this.state, bindings: merged });
  }

  startTimer(): Timer {
    const start = this.state.clock();
    const elapsed = (): number => this.state.clock() - start;
    const done = (arg1?: LogFields | string, arg2?: string): void => {
      const durationMs = elapsed();
      if (typeof arg1 === 'string') {
        this.info({ durationMs }, arg1);
      } else if (arg1 && typeof arg1 === 'object') {
        this.info({ ...arg1, durationMs }, arg2);
      } else {
        this.info({ durationMs });
      }
    };
    return { done, elapsed };
  }

  async flush(): Promise<void> {
    await this.state.transport.flush?.();
  }

  async close(): Promise<void> {
    await this.state.transport.close?.();
  }

  private emit(
    levelNum: number,
    levelName: LogLevelName,
    arg1: LogFields | string | Error | undefined,
    arg2: string | undefined,
  ): void {
    if (levelNum >= SILENT || levelNum < this.threshold) {
      return;
    }

    let callFields: LogFields | undefined;
    let msg: string | undefined;

    if (typeof arg1 === 'string') {
      msg = arg1;
    } else if (arg1 instanceof Error) {
      callFields = { err: arg1 };
      msg = typeof arg2 === 'string' ? arg2 : arg1.message;
    } else if (arg1 && typeof arg1 === 'object') {
      callFields = arg1;
      msg = typeof arg2 === 'string' ? arg2 : undefined;
    } else if (arg1 !== undefined && arg1 !== null) {
      msg = String(arg1);
    }

    const bindings = this.state.bindings;
    const hasBindings = Object.keys(bindings).length > 0;
    const merged: LogFields =
      callFields && hasBindings
        ? { ...bindings, ...callFields }
        : callFields ?? (hasBindings ? { ...bindings } : {});

    const record: LogRecord = {
      level: levelNum,
      levelName,
      time: this.state.clock(),
      name: this.state.name,
      msg,
      fields: this.state.redactor.redact(merged),
    };

    try {
      this.state.transport.write(record);
    } catch (error) {
      this.state.onError(error, record);
    }
  }
}

/**
 * Create a logger.
 *
 * All options are optional: the default is an `info`-level logger that writes
 * JSON lines to stdout with the built-in secret redaction applied.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const state: LoggerState = {
    name: options.name,
    bindings: options.base ? { ...options.base } : {},
    transport: options.transport ?? new ConsoleTransport(),
    redactor: createRedactor(options.redact),
    clock: options.clock ?? Date.now,
    onError: options.onError ?? defaultOnError,
  };
  return new LoggerImpl(options.level ?? 'info', state);
}
