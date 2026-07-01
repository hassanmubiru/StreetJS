// src/tests/memory-adapter.test.ts
// Task 9.2 — unit tests for the default cluster adapter, its no-external-contact
// guarantee, and the init-failure-no-fallback behavior. Exercised through the
// facade (`createRealtime`) over a no-op WebSocket server and against a
// `MemoryAdapter` constructed directly, with no network socket (Req 16.3).
//
//   - Req 12.2: WHERE no Cluster_Adapter is explicitly configured, the facade
//     uses the `MemoryAdapter` by default. Verified via
//     `createRealtime({ server }).adapter instanceof MemoryAdapter`.
//   - Req 12.3: WHILE the Memory_Adapter is active, broadcasts and presence
//     updates are delivered within the single instance WITHOUT contacting any
//     external service. Verified two ways: (a) a `ClusterSink` spy handed to
//     `MemoryAdapter.init` whose callbacks `assert.fail` if ever invoked proves
//     the adapter re-injects nothing / contacts nothing across instances, its
//     `remotePresence` returns `[]`, and `health()` is `up`; and (b) driving
//     join/broadcast/presence on the default facade shows the single-instance
//     path works end-to-end while the distributed union stays local
//     (`adapter.remotePresence(...) === []`).
//   - Req 12.5: IF an explicitly configured adapter's `init` rejects, the facade
//     fails initialization with a descriptive error and does NOT fall back to a
//     `MemoryAdapter`. Verified by supplying a failing adapter, awaiting a facade
//     operation (which rejects with the descriptive init error), and asserting
//     `facade.adapter` is the supplied failing adapter (not a `MemoryAdapter`).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StreetWebSocketServer } from 'streetjs';
import { createRealtime, MemoryAdapter, FakeConnection } from '../index.js';
import type { ClusterAdapter, ClusterSink, Member, RealtimeMessage, BroadcastOptions } from '../index.js';

/** Build a facade over a no-op WebSocket server (no port bound). */
function makeServer(): StreetWebSocketServer {
  return new StreetWebSocketServer();
}

const member = (id: string): Member => ({ id });

test('facade uses a MemoryAdapter by default when none is configured (Req 12.2)', async () => {
  const realtime = createRealtime({ server: makeServer() });
  try {
    assert.ok(
      realtime.adapter instanceof MemoryAdapter,
      'expected the default facade adapter to be a MemoryAdapter',
    );
  } finally {
    await realtime.close();
  }
});

test('MemoryAdapter is inert and contacts nothing: sink spy is never invoked, remotePresence is [] (Req 12.3)', async () => {
  const adapter = new MemoryAdapter();

  // A spy sink whose callbacks FAIL the test if the adapter ever tries to
  // re-inject a remote broadcast or apply a remote presence delta. For an
  // inert, single-instance adapter that contacts no external service, these
  // must never fire — there is no peer to receive from.
  const sink: ClusterSink = {
    deliverLocal: () =>
      assert.fail('MemoryAdapter must not re-inject remote broadcasts (no external contact)'),
    applyRemotePresence: () =>
      assert.fail('MemoryAdapter must not apply remote presence (no external contact)'),
  };

  // init resolves immediately (nothing to connect).
  await assert.doesNotReject(adapter.init(sink));

  // publish / publishPresence are no-ops that resolve without contacting anything…
  await assert.doesNotReject(
    adapter.publish('room', { type: 'message', payload: { text: 'hi' } }, {}),
  );
  await assert.doesNotReject(adapter.publishPresence('room', 'm1', 'join'));
  await assert.doesNotReject(adapter.publishPresence('room', 'm1', 'leave'));

  // …remotePresence returns [] so the distributed union equals local presence…
  assert.deepEqual(await adapter.remotePresence('room'), []);
  assert.deepEqual(await adapter.remotePresence('any-other-channel'), []);

  // …health is always up (no external dependency can fail)…
  assert.deepEqual(adapter.health(), { status: 'up' });

  // …and close resolves cleanly. The spy sink was never invoked, proving no
  // cross-instance / external contact occurred.
  await assert.doesNotReject(adapter.close());
});

test('default facade path: join/broadcast/presence work locally while remotePresence stays [] (Req 12.3)', async () => {
  const realtime = createRealtime({ server: makeServer() });
  try {
    const room = realtime.room('lobby');
    const a = new FakeConnection({ id: 'a' });
    const b = new FakeConnection({ id: 'b' });

    await room.join(member('alice'), a);
    await room.join(member('bob'), b);

    // Broadcast is delivered within the single instance…
    await room.broadcast({ type: 'message', payload: { text: 'hello' } });
    assert.equal(a.eventsOfType('message').length, 1);
    assert.equal(b.eventsOfType('message').length, 1);

    // Presence reflects local membership; the distributed union equals it…
    assert.deepEqual((await room.presence()).sort(), ['alice', 'bob']);
    assert.equal(await room.memberCount(), 2);

    // …and the default adapter reaches no peers: remotePresence is always [].
    assert.deepEqual(await realtime.adapter.remotePresence('lobby'), []);
  } finally {
    await realtime.close();
  }
});

/** A ClusterAdapter whose `init` always rejects, used to exercise Req 12.5. */
class FailingAdapter implements ClusterAdapter {
  /** Records whether any post-init method was reached (it must not be). */
  reached = false;

  async init(_sink: ClusterSink): Promise<void> {
    throw new Error('boom: cannot reach cluster backend');
  }

  async publish(_c: string, _m: RealtimeMessage, _o: BroadcastOptions): Promise<void> {
    this.reached = true;
  }

  async publishPresence(_c: string, _m: string, _s: 'join' | 'leave'): Promise<void> {
    this.reached = true;
  }

  async remotePresence(_c: string): Promise<string[]> {
    this.reached = true;
    return [];
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    return { status: 'down' };
  }

  async close(): Promise<void> {
    // no-op.
  }
}

test('an explicitly configured adapter whose init rejects fails a facade op without falling back to MemoryAdapter (Req 12.5)', async () => {
  const failing = new FailingAdapter();
  const realtime = createRealtime({ server: makeServer(), adapter: failing });
  try {
    // The facade keeps the explicitly configured adapter — NO MemoryAdapter fallback.
    assert.equal(realtime.adapter, failing, 'facade must keep the configured (failing) adapter');
    assert.ok(
      !(realtime.adapter instanceof MemoryAdapter),
      'facade must NOT fall back to a MemoryAdapter on init failure',
    );

    // Awaiting a facade operation surfaces the descriptive init error (it awaits
    // `ctx.ready`, which rejects because the adapter failed to initialize).
    await assert.rejects(
      realtime.room('secure-room').join(member('carol'), new FakeConnection({ id: 'c' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /cluster adapter failed to initialize/i);
        // The original cause is preserved in the descriptive message.
        assert.match(err.message, /boom: cannot reach cluster backend/);
        return true;
      },
    );

    // A presence query surfaces the same failure for the same reason.
    await assert.rejects(
      realtime.room('secure-room').presence(),
      /cluster adapter failed to initialize/i,
    );
  } finally {
    await realtime.close();
  }
});
