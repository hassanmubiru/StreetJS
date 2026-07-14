/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Shows how an application registers liveness/readiness checks and serves the
 * IETF health+json report. Self-contained (no other package required).
 */

import { HealthRegistry } from '../index.js';

async function main(): Promise<void> {
  const health = new HealthRegistry();

  // Liveness: the process is up. Usually trivial.
  health.register({ name: 'process', kind: 'liveness', check: () => {} });

  // Readiness: dependencies are usable. These would ping real resources.
  health.register({
    name: 'database',
    kind: 'readiness',
    check: async () => {
      // await db.query('SELECT 1');
      return { status: 'pass', observedValue: 3, observedUnit: 'ms', output: 'query ok' };
    },
  });
  health.register({
    name: 'cache',
    kind: 'readiness',
    critical: false, // a cache outage degrades, but does not fail readiness
    check: () => {
      throw new Error('redis connection refused');
    },
  });

  const liveness = await health.endpoint('liveness');
  const readiness = await health.endpoint('readiness');

  process.stdout.write(`liveness  -> ${liveness.statusCode} ${liveness.report.status}\n`);
  process.stdout.write(`readiness -> ${readiness.statusCode} ${readiness.report.status}\n`);
  process.stdout.write(`Content-Type: ${readiness.contentType}\n`);
  process.stdout.write(readiness.body + '\n');
}

void main();
