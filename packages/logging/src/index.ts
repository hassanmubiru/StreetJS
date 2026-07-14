/**
 * @streetjs/logging — the StreetJS logging foundation.
 *
 * Public API only. Internal helpers are not exported.
 *
 * ```ts
 * import { createLogger } from '@streetjs/logging';
 *
 * const log = createLogger({ name: 'api', level: 'info' });
 * log.info({ port: 3000 }, 'listening');
 * const child = log.child({ requestId: 'abc' });
 * child.error(new Error('boom'), 'request failed');
 * ```
 */

export { createLogger } from './logger.js';

export {
  LEVELS,
  EMITTING_LEVELS,
  isLevelName,
  severityOf,
  levelNameOf,
  type LogLevelName,
} from './levels.js';

export {
  ConsoleTransport,
  StreamTransport,
  MemoryTransport,
  MultiTransport,
  formatJsonLine,
  formatPrettyLine,
  toWireObject,
  type ConsoleTransportOptions,
} from './transport.js';

export { DefaultRedactor, createRedactor, DEFAULT_REDACT_KEYS } from './redaction.js';

export { serializeError } from './serialize.js';

export type {
  Logger,
  LoggerOptions,
  LogRecord,
  LogFields,
  Transport,
  Redactor,
  RedactionOptions,
  Clock,
  Timer,
  TransportErrorHandler,
  JsonValue,
} from './types.js';

/**
 * Dependency-injection token for a {@link Logger}.
 *
 * `@streetjs/logging` does not depend on any container, so the token is a
 * plain unique symbol. Register the logger instance under this token in your
 * application's container and resolve it wherever a logger is needed — see the
 * "Dependency injection" section of the README.
 */
export const LOGGER: unique symbol = Symbol.for('@streetjs/logging:Logger');
