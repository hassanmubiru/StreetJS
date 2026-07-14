/**
 * Built-in transports and helpers.
 *
 *   - {@link ConsoleTransport}  JSON (default) or pretty lines to stdout/stderr.
 *   - {@link StreamTransport}   JSON lines to any writable stream.
 *   - {@link MemoryTransport}   in-memory capture for tests and assertions.
 *   - {@link MultiTransport}    fan-out to several transports.
 *
 * Depends on `types` and `levels` only.
 */

import type { JsonValue, LogRecord, Transport } from './types.js';
import { EMITTING_LEVELS, LEVELS, type LogLevelName } from './levels.js';

const RESERVED_KEYS = new Set(['level', 'levelName', 'time', 'name', 'msg']);

/**
 * Merge a record's reserved members and its `fields` into a single wire object,
 * with reserved members taking precedence over any colliding field key.
 */
export function toWireObject(record: LogRecord): Record<string, JsonValue> {
  const wire: Record<string, JsonValue> = {
    level: record.level,
    levelName: record.levelName,
    time: record.time,
  };
  if (record.name !== undefined) {
    wire.name = record.name;
  }
  if (record.msg !== undefined) {
    wire.msg = record.msg;
  }
  for (const key of Object.keys(record.fields)) {
    if (!RESERVED_KEYS.has(key)) {
      wire[key] = record.fields[key];
    }
  }
  return wire;
}

/** Serialize a record to a single JSON line (newline-terminated). */
export function formatJsonLine(record: LogRecord): string {
  return JSON.stringify(toWireObject(record)) + '\n';
}

const ANSI: Readonly<Record<LogLevelName, string>> = Object.freeze({
  trace: '\x1b[90m',
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  fatal: '\x1b[35m',
  silent: '',
});
const ANSI_RESET = '\x1b[0m';

const LEVEL_LABEL_WIDTH = Math.max(...EMITTING_LEVELS.map((l) => l.length));

/** Serialize a record to a human-readable line (newline-terminated). */
export function formatPrettyLine(record: LogRecord, colors: boolean): string {
  const iso = new Date(record.time).toISOString();
  const label = record.levelName.toUpperCase().padEnd(LEVEL_LABEL_WIDTH);
  const level = colors ? `${ANSI[record.levelName]}${label}${ANSI_RESET}` : label;
  const namePart = record.name !== undefined ? ` (${record.name})` : '';
  const msgPart = record.msg !== undefined ? ` ${record.msg}` : '';

  const extras: Record<string, JsonValue> = {};
  for (const key of Object.keys(record.fields)) {
    if (!RESERVED_KEYS.has(key)) {
      extras[key] = record.fields[key];
    }
  }
  const extraKeys = Object.keys(extras);
  const extraPart = extraKeys.length > 0 ? ` ${JSON.stringify(extras)}` : '';

  return `${iso} ${level}${namePart}${msgPart}${extraPart}\n`;
}

/** Options for {@link ConsoleTransport}. */
export interface ConsoleTransportOptions {
  /** Output format. Default `"json"`. */
  readonly format?: 'json' | 'pretty';
  /** Colorize pretty output. Default `false`. Ignored for JSON. */
  readonly colors?: boolean;
  /** Route records at or above this level to stderr. Default `"silent"` (none). */
  readonly stderrLevel?: LogLevelName;
  /** Override the stdout writer (primarily for testing). */
  readonly stdout?: (chunk: string) => void;
  /** Override the stderr writer (primarily for testing). */
  readonly stderr?: (chunk: string) => void;
}

/** Writes formatted lines to stdout/stderr. */
export class ConsoleTransport implements Transport {
  readonly name = 'console';
  private readonly format: 'json' | 'pretty';
  private readonly colors: boolean;
  private readonly stderrThreshold: number;
  private readonly writeOut: (chunk: string) => void;
  private readonly writeErr: (chunk: string) => void;

  constructor(options: ConsoleTransportOptions = {}) {
    this.format = options.format ?? 'json';
    this.colors = options.colors ?? false;
    this.stderrThreshold = LEVELS[options.stderrLevel ?? 'silent'];
    this.writeOut = options.stdout ?? ((chunk) => void process.stdout.write(chunk));
    this.writeErr = options.stderr ?? ((chunk) => void process.stderr.write(chunk));
  }

  write(record: LogRecord): void {
    const line =
      this.format === 'pretty' ? formatPrettyLine(record, this.colors) : formatJsonLine(record);
    if (record.level >= this.stderrThreshold) {
      this.writeErr(line);
    } else {
      this.writeOut(line);
    }
  }
}

/** Writes JSON lines to any Node writable stream. */
export class StreamTransport implements Transport {
  readonly name: string;
  private readonly stream: NodeJS.WritableStream;

  constructor(stream: NodeJS.WritableStream, name = 'stream') {
    this.stream = stream;
    this.name = name;
  }

  write(record: LogRecord): void {
    this.stream.write(formatJsonLine(record));
  }
}

/** Captures records in memory. Ideal for tests. */
export class MemoryTransport implements Transport {
  readonly name = 'memory';
  private readonly buffer: LogRecord[] = [];

  write(record: LogRecord): void {
    this.buffer.push(record);
  }

  /** All captured records, in write order. */
  get records(): readonly LogRecord[] {
    return this.buffer;
  }

  /** Captured records at a specific level. */
  recordsAt(level: LogLevelName): readonly LogRecord[] {
    return this.buffer.filter((r) => r.levelName === level);
  }

  /** The most recently captured record, or `undefined`. */
  last(): LogRecord | undefined {
    return this.buffer[this.buffer.length - 1];
  }

  /** Discard all captured records. */
  clear(): void {
    this.buffer.length = 0;
  }
}

/** Fans a record out to several transports. Failures are isolated per transport. */
export class MultiTransport implements Transport {
  readonly name = 'multi';
  private readonly transports: readonly Transport[];

  constructor(transports: readonly Transport[]) {
    this.transports = transports;
  }

  write(record: LogRecord): void {
    for (const transport of this.transports) {
      transport.write(record);
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.flush?.()));
  }

  async close(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.close?.()));
  }
}
