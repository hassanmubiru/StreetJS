// src/tests/example-smoke.test.ts
// Task 15.2: Execute the runnable `room(...).join(...).broadcast(...)` example
// as an automated smoke test so it stays working, complementing the
// property/unit/integration suite covering rooms, presence, typing, broadcast
// scope, auth, authorization, and rate limiting.
//
// Validates Requirements 19.2 (a runnable example demonstrates the canonical
// room/join/broadcast flow) and 19.3 (that example is exercised as a smoke test
// so it does not silently rot).
//
// The test imports `main` from the compiled example (`../examples/room-broadcast.js`)
// and runs it directly — no child process is spawned and no network socket is
// opened. It then asserts on the returned `ExampleResult` so the smoke test
// meaningfully verifies the documented flow: both members appear in presence and
// the broadcast reaches only the non-sending connection (Req 7.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { main, type ExampleResult } from '../examples/room-broadcast.js';

test('room().join().broadcast() example runs and delivers per the documented flow (Req 19.2, 19.3)', async () => {
  const result: ExampleResult = await main();

  // The example broadcasts to the "general" room.
  assert.equal(result.room, 'general');

  // Both members joined; presence is the union of alice + bob (order-insensitive).
  assert.deepEqual([...result.presence].sort(), ['alice', 'bob']);

  // Alice excluded her own connection, so only Bob received the message (Req 7.2).
  assert.deepEqual(result.bobReceived, ['message']);

  // The sender (Alice) did not receive her own broadcast back.
  assert.deepEqual(result.aliceReceived, []);
});
