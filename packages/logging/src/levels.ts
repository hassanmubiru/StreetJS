/**
 * Log levels and their numeric severities.
 *
 * A record is emitted when its severity is greater than or equal to the
 * logger's configured threshold. `silent` (100) is higher than every real
 * level, so setting a logger to `silent` disables all output.
 *
 * This module has no internal imports — it is a leaf of the dependency graph.
 */

/** The canonical, ordered set of level names. */
export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/** Numeric severity for each level. Lower is more verbose. */
export const LEVELS: Readonly<Record<LogLevelName, number>> = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100,
});

/** The level names that produce output, in ascending severity (excludes `silent`). */
export const EMITTING_LEVELS: readonly LogLevelName[] = Object.freeze([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]);

/** Reverse lookup from a numeric severity to its level name. */
const BY_SEVERITY: ReadonlyMap<number, LogLevelName> = new Map(
  (Object.keys(LEVELS) as LogLevelName[]).map((name) => [LEVELS[name], name]),
);

/** True when `value` is one of the known level names. */
export function isLevelName(value: unknown): value is LogLevelName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LEVELS, value);
}

/**
 * Resolve a level name to its numeric severity.
 *
 * @throws {RangeError} when `name` is not a known level.
 */
export function severityOf(name: LogLevelName): number {
  const severity = LEVELS[name];
  if (severity === undefined) {
    throw new RangeError(`Unknown log level: ${String(name)}`);
  }
  return severity;
}

/** Resolve a numeric severity back to its level name, or `undefined` if unmapped. */
export function levelNameOf(severity: number): LogLevelName | undefined {
  return BY_SEVERITY.get(severity);
}
