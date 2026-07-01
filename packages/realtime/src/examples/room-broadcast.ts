// src/examples/room-broadcast.ts
// Runnable example: the canonical `realtime.room(...).join(...).broadcast(...)`
// flow (Req 19.2).
//
// In a consuming application you would import from the published package:
//
//   import { createRealtime, FakeConnection } from '@streetjs/realtime';
//   import type { Member } from '@streetjs/realtime';
//
// Inside this package's own source tree we import from the package's public
// entry point (`../index.js`) so the example exercises exactly the public
// surface a consumer sees — nothing internal.
//
// The example uses `FakeConnection` (a public testing utility) as the transport
// so it runs with no network socket and no external service (the default
// `MemoryAdapter` contacts nothing). It builds a `StreetWebSocketServer` with
// `noServer: true` semantics — constructing it opens no listening socket and
// schedules no timers — purely to satisfy `createRealtime`, which attaches over
// an existing server.
//
// Run it directly on the compiled output:
//
//   npm run build && node dist/examples/room-broadcast.js
//
// It is also structured so the example smoke test (task 15.2) can `import { main }`
// and assert on the returned result without spawning a process.

import { fileURLToPath } from 'node:url';
import { StreetWebSocketServer } from 'streetjs';
import { createRealtime, FakeConnection } from '../index.js';
import type { Member } from '../index.js';

/** Shape returned by {@link main} so a smoke test can assert on the outcome. */
export interface ExampleResult {
  /** The room name the members joined and the message was broadcast to. */
  readonly room: string;
  /** Member ids present in the room after both members joined. */
  readonly presence: readonly string[];
  /** Message `type` values Bob's connection received (the sender is excluded). */
  readonly bobReceived: readonly string[];
  /** Message `type` values Alice's connection received (she is the sender). */
  readonly aliceReceived: readonly string[];
}

/**
 * Demonstrate the end-to-end room/join/broadcast flow:
 *
 *   1. Construct the `Realtime` facade over a WebSocket server.
 *   2. Two members (`alice`, `bob`) join the `"general"` room, each over a
 *      connection.
 *   3. `alice` broadcasts a `"message"` event, excluding her own connection so
 *      only `bob` receives it (Req 7.2).
 *
 * Returns an {@link ExampleResult} snapshot of presence and per-connection
 * delivery so the flow can be asserted programmatically. Always tears the
 * facade down so no resources leak.
 */
export async function main(): Promise<ExampleResult> {
  // A real application already has a StreetWebSocketServer; the facade attaches
  // over it. Constructing one opens no listening socket.
  const server = new StreetWebSocketServer();

  // Create the facade. With no `adapter` configured it defaults to the
  // zero-dependency, single-instance MemoryAdapter (no external service).
  const realtime = createRealtime({ server });

  try {
    const alice: Member = { id: 'alice' };
    const bob: Member = { id: 'bob' };

    // Each member joins over a connection. FakeConnection records every event
    // emitted to it, standing in for a live StreetSocket.
    const aliceConn = new FakeConnection({ id: 'alice-conn' });
    const bobConn = new FakeConnection({ id: 'bob-conn' });

    const room = realtime.room('general');
    await room.join(alice, aliceConn);
    await room.join(bob, bobConn);

    const presence = await room.presence();
    console.log(`[example] "${room.name}" presence:`, presence);

    // Alice broadcasts a typed message, excluding her own connection so she
    // does not receive her own message back (Req 7.2).
    await room.broadcast(
      { type: 'message', payload: { text: 'Hello, StreetJS!' } },
      { exceptConnId: aliceConn.id },
    );

    const bobReceived = bobConn.eventsOfType('message').map((e) => e.type);
    const aliceReceived = aliceConn.eventsOfType('message').map((e) => e.type);

    console.log('[example] bob received message events:', bobReceived.length);
    console.log('[example] alice received message events:', aliceReceived.length);

    return {
      room: room.name,
      presence,
      bobReceived,
      aliceReceived,
    };
  } finally {
    await realtime.close();
  }
}

// Run `main()` only when this module is executed directly (e.g.
// `node dist/examples/room-broadcast.js`), never when a test imports it. In
// NodeNext ESM the entry module's absolute path is `process.argv[1]`, which
// equals this module's path resolved from `import.meta.url`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error('[example] failed:', err);
    process.exitCode = 1;
  });
}
