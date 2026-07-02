// src/tests/example-smoke.test.ts
// Executes the runnable example (examples/basic.ts) as an automated smoke test
// so the documented end-to-end flow stays working.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { main } from '../examples/basic.js';

test('runnable example: publish, wildcard, middleware, bridges, and replay all work', async () => {
  const result = await main(true);

  // user.created delivered → published user.verified; both audited in order.
  assert.deepEqual(result.auditLog.slice(0, 2), ['user.created', 'user.verified']);
  // The wildcard user.* listener recorded the verified user.
  assert.deepEqual(result.verifiedUsers, ['u1']);
  // The queue→events→realtime chain produced a report.generated broadcast.
  assert.ok(
    result.broadcasts.some((b) => b.room === 'reports' && b.type === 'report.generated'),
    'expected a reports broadcast from the bridged queue event',
  );
  // report.generated was audited too (queue bridge published it).
  assert.ok(result.auditLog.includes('report.generated'));
  // Replay re-dispatched every stored event (user.created, user.verified, report.generated).
  assert.equal(result.replayedCount, 3);
});
