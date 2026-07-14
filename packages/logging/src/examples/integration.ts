/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Demonstrates how a StreetJS package or application wires a logger through
 * its request lifecycle — child loggers per request, structured fields,
 * automatic secret redaction, timers, and error logging. Self-contained (no
 * other package required) so it doubles as a smoke test.
 */

import { createLogger, MemoryTransport, type Logger } from '../index.js';

// A tiny "service" that receives a logger via constructor injection — the
// interface-first / DI pattern every StreetJS package follows.
class UserService {
  constructor(private readonly log: Logger) {}

  authenticate(requestId: string, username: string, password: string): boolean {
    // `password` is redacted automatically by key name — it never hits output.
    const reqLog = this.log.child({ requestId, username });
    const timer = reqLog.startTimer();
    reqLog.debug({ password }, 'authenticating');

    const ok = password.length >= 8;
    if (!ok) {
      reqLog.warn('authentication rejected: weak credential');
      return false;
    }
    timer.done('authenticated');
    return true;
  }
}

function main(): void {
  // Application root logger. In production the level typically comes from
  // @streetjs/config, e.g. `createLogger({ level: config.get('logLevel') })`.
  const rootLog = createLogger({ name: 'example-app', level: 'debug' });
  rootLog.info({ version: '1.0.0' }, 'service starting');

  const service = new UserService(rootLog.child({ component: 'users' }));
  service.authenticate('req-1', 'alice', 'correct horse battery');
  service.authenticate('req-2', 'bob', 'short');

  try {
    throw Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' });
  } catch (err) {
    rootLog.error(err, 'startup dependency check failed');
  }

  // The same logger API drives an in-memory transport for tests/assertions.
  const memory = new MemoryTransport();
  const testLog = createLogger({ transport: memory, level: 'trace' });
  testLog.info({ token: 'super-secret' }, 'redaction demo');
  const captured = memory.last();
  rootLog.info(
    { capturedFields: captured?.fields },
    'captured record shows the token was redacted',
  );

  rootLog.info('example complete');
}

main();
