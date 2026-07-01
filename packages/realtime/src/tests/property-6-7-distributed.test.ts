// src/tests/property-6-7-distributed.test.ts
//
// Feature: realtime-framework, Property 6: Distributed presence is the union
// across instances — For any set of server instances each holding an arbitrary
// set of present members for a room, Room.presence() returns exactly the union
// of members present across all connected instances, and the room is considered
// empty if and only if that distributed union is empty.
//
// Feature: realtime-framework, Property 7: Cross-instance broadcast delivers
// exactly once per connection — For any cluster of instances sharing the
// fan-out bus and any broadcast published from any one instance to a room,
// every eligible connection across all instances receives the message exactly
// once (the publisher delivers locally and discards its own echoed envelope;
// each peer delivers once on the single foreign envelope), and excluded
// connections receive it zero times.
//
// Validates: Requirements 5.4, 5.6, 7.6, 13.1
//
// These distributed properties run over an IN-MEMORY simulated cluster bus (no
// real Redis). The bus below is a faithful in-process stand-in for the
// RedisAdapter's pub/sub fan-out: every facade instance owns an
// `InMemoryClusterAdapter` that, on `publish`/`publishPresence`, stamps a
// `ClusterEnvelope` with its own `instanceId` and hands it to the shared bus.
// The bus delivers each envelope to EVERY adapter (including the publisher,
// modelling the pub/sub echo); each adapter discards its own echo
// (`origin === instanceId`) and re-injects a FOREIGN broadcast into its local
// hub via `sink.deliverLocal` (exactly once per local connection) or mirrors a
// FOREIGN presence delta via `sink.applyRemotePresence` — exactly like
// RedisAdapter.onMessage, but in-process. Connections are `FakeConnection`s
// (Req 16) over no-op `StreetWebSocketServer`s so no network socket is opened.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { StreetWebSocketServer } from 'streetjs';
import { createRealtime, FakeConnection } from '../index.js';
import type {
  ClusterAdapter,
  ClusterSink,
  RealtimeMessage,
  BroadcastOptions,
  Realtime,
  Room,
  Member,
} from '../index.js';

// ── In-memory simulated cluster bus (stand-in for Redis pub/sub) ──────────────

/** The cross-instance propagation envelope, mirroring the Redis transport shape. */
interface ClusterEnvelope {
  kind: 'broadcast' | 'presence';
  /** `instanceId` of the publisher; every receiver discards its own echo. */
  origin: string;
  channel: string;
  message?: RealtimeMessage;
  options?: BroadcastOptions;
  memberId?: string;
  state?: 'join' | 'leave';
}

/**
 * A shared, in-process fan-out bus. `publish` delivers the envelope to EVERY
 * registered adapter (including the origin), exactly as a Redis pub/sub topic
 * echoes a published message back to the publisher's own subscription. Each
 * adapter is responsible for discarding its own echo.
 */
class InMemoryClusterBus {
  private readonly adapters = new Set<InMemoryClusterAdapter>();

  register(adapter: InMemoryClusterAdapter): void {
    this.adapters.add(adapter);
  }

  unregister(adapter: InMemoryClusterAdapter): void {
    this.adapters.delete(adapter);
  }

  /** Fan `envelope` out to every registered adapter (publisher included). */
  publish(envelope: ClusterEnvelope): void {
    for (const adapter of this.adapters) {
      adapter.receive(envelope);
    }
  }
}

/**
 * A `ClusterAdapter` bound to a shared {@link InMemoryClusterBus}. On
 * `publish`/`publishPresence` it stamps an envelope with its own `instanceId`
 * and hands it to the bus; on receipt it discards its own echo and re-injects
 * foreign envelopes into the local hub through the facade `sink` — the exact
 * dedupe/union logic the RedisAdapter implements, exercised without Redis.
 *
 * `remotePresence` returns `[]`: the facade's authoritative peer-presence source
 * is the mirror fed by `sink.applyRemotePresence`, which this adapter drives on
 * every foreign presence envelope (matching how `Room.presence()` unions the
 * mirror in). This keeps the union computation identical to production while
 * avoiding any external store.
 */
class InMemoryClusterAdapter implements ClusterAdapter {
  readonly instanceId: string;
  private readonly bus: InMemoryClusterBus;
  private sink: ClusterSink | null = null;

  constructor(bus: InMemoryClusterBus, instanceId: string) {
    this.bus = bus;
    this.instanceId = instanceId;
  }

  async init(sink: ClusterSink): Promise<void> {
    this.sink = sink;
    this.bus.register(this);
  }

  async publish(
    channel: string,
    message: RealtimeMessage,
    options: BroadcastOptions,
  ): Promise<void> {
    this.bus.publish({ kind: 'broadcast', origin: this.instanceId, channel, message, options });
  }

  async publishPresence(
    channel: string,
    memberId: string,
    state: 'join' | 'leave',
  ): Promise<void> {
    this.bus.publish({ kind: 'presence', origin: this.instanceId, channel, memberId, state });
  }

  async remotePresence(_channel: string): Promise<string[]> {
    // The facade mirror (fed by applyRemotePresence) is the authoritative peer
    // source; nothing extra to contribute here.
    return [];
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    return { status: 'up' };
  }

  async close(): Promise<void> {
    this.bus.unregister(this);
    this.sink = null;
  }

  /**
   * Receive an envelope from the bus. Discards our own echo
   * (`origin === instanceId`) exactly as RedisAdapter.onMessage does, then
   * re-injects a foreign broadcast (once per local connection) or mirrors a
   * foreign presence delta into the facade.
   */
  receive(envelope: ClusterEnvelope): void {
    if (envelope.origin === this.instanceId) return; // discard own echo
    const sink = this.sink;
    if (!sink) return;
    if (envelope.kind === 'broadcast' && envelope.message) {
      sink.deliverLocal(envelope.channel, envelope.message, envelope.options ?? {});
    } else if (
      envelope.kind === 'presence' &&
      typeof envelope.memberId === 'string' &&
      (envelope.state === 'join' || envelope.state === 'leave')
    ) {
      sink.applyRemotePresence(envelope.channel, envelope.memberId, envelope.state);
    }
  }
}

/** A single cluster instance: its facade plus the room handle under test. */
interface ClusterInstance {
  realtime: Realtime;
  room: Room;
}

/**
 * Build `numInstances` facade instances all sharing one in-memory bus, each
 * over its own no-op `StreetWebSocketServer`, and force every adapter to finish
 * `init` (register with the bus) before any presence/broadcast fan-out occurs.
 */
async function buildCluster(numInstances: number, roomName: string): Promise<ClusterInstance[]> {
  const bus = new InMemoryClusterBus();
  const instances: ClusterInstance[] = [];
  for (let i = 0; i < numInstances; i++) {
    const realtime = createRealtime({
      server: new StreetWebSocketServer(),
      adapter: new InMemoryClusterAdapter(bus, `instance-${i}`),
    });
    instances.push({ realtime, room: realtime.room(roomName) });
  }
  // Warm-up: awaiting a room op resolves each facade's `ready` (adapter init),
  // guaranteeing every adapter is registered with the bus before any joins so
  // no presence delta is fanned to a not-yet-subscribed peer.
  await Promise.all(instances.map((inst) => inst.room.presence()));
  return instances;
}

async function closeCluster(instances: ClusterInstance[]): Promise<void> {
  await Promise.all(instances.map((inst) => inst.realtime.close()));
}

const memberId = (index: number): string => `m${index}`;
const member = (index: number): Member => ({ id: memberId(index) });

// ── Property 6: distributed presence is the union across instances ────────────

interface P6Scenario {
  numInstances: number;
  room: string;
  /** assignments[m] = the instance indices on which member `m{m}` is present. */
  assignments: number[][];
}

const p6Arb: fc.Arbitrary<P6Scenario> = fc.integer({ min: 2, max: 4 }).chain((numInstances) =>
  fc.record({
    numInstances: fc.constant(numInstances),
    room: fc.string({ minLength: 1, maxLength: 12 }),
    // 0..5 members; each present on a (possibly empty) unique subset of
    // instances — so the union covers empty, partial, and full-overlap cases.
    assignments: fc.array(
      fc.uniqueArray(fc.integer({ min: 0, max: numInstances - 1 }), { maxLength: numInstances }),
      { minLength: 0, maxLength: 5 },
    ),
  }),
);

test('Property 6: distributed presence is the union across instances', async () => {
  await fc.assert(
    fc.asyncProperty(p6Arb, async (scenario) => {
      const { numInstances, room, assignments } = scenario;
      const instances = await buildCluster(numInstances, room);
      try {
        // Join each member on every instance it is assigned to, over a distinct
        // connection per (member, instance).
        for (let m = 0; m < assignments.length; m++) {
          for (const inst of assignments[m]) {
            const conn = new FakeConnection({ id: `c-${m}-${inst}` });
            await instances[inst].room.join(member(m), conn);
          }
        }

        // The distributed union: every member present on at least one instance.
        const expectedUnion = assignments
          .map((instList, m) => (instList.length > 0 ? memberId(m) : null))
          .filter((id): id is string => id !== null)
          .sort();

        // Every instance's presence()/memberCount() must equal the union, and
        // the room is empty iff the union is empty (Req 5.4, 5.6).
        for (let i = 0; i < numInstances; i++) {
          const presence = (await instances[i].room.presence()).slice().sort();
          assert.deepEqual(
            presence,
            expectedUnion,
            `instance ${i} presence must equal the distributed union`,
          );
          assert.equal(
            await instances[i].room.memberCount(),
            expectedUnion.length,
            `instance ${i} memberCount must equal the union size`,
          );
          assert.equal(
            presence.length === 0,
            expectedUnion.length === 0,
            `instance ${i} must be empty iff the distributed union is empty`,
          );
        }
      } finally {
        await closeCluster(instances);
      }
    }),
    { numRuns: 100 },
  );
});

// ── Property 7: cross-instance broadcast delivers exactly once per connection ─

interface P7Conn {
  /** Instance index this connection joins the room on. */
  instance: number;
  /** Member index owning this connection. */
  member: number;
}

interface P7Scenario {
  numInstances: number;
  room: string;
  /** In-room connections distributed across instances. */
  conns: P7Conn[];
  /** Count of out-of-room connections opened per instance (never joined). */
  outsidePerInstance: number[];
  /** Instance index the broadcast is published from. */
  publisher: number;
  /** Index into `conns` to exclude by connection id, or undefined. */
  exceptConnRaw: number | undefined;
  /** Member index to exclude by member id, or undefined. */
  exceptMemberRaw: number | undefined;
}

const MAX_MEMBER = 3;

const p7Arb: fc.Arbitrary<P7Scenario> = fc.integer({ min: 2, max: 4 }).chain((numInstances) =>
  fc.record({
    numInstances: fc.constant(numInstances),
    room: fc.string({ minLength: 1, maxLength: 12 }),
    conns: fc.array(
      fc.record({
        instance: fc.integer({ min: 0, max: numInstances - 1 }),
        member: fc.integer({ min: 0, max: MAX_MEMBER }),
      }),
      { minLength: 1, maxLength: 10 },
    ),
    outsidePerInstance: fc.array(fc.integer({ min: 0, max: 2 }), {
      minLength: numInstances,
      maxLength: numInstances,
    }),
    publisher: fc.integer({ min: 0, max: numInstances - 1 }),
    exceptConnRaw: fc.option(fc.nat(), { nil: undefined }),
    exceptMemberRaw: fc.option(fc.nat({ max: MAX_MEMBER }), { nil: undefined }),
  }),
);

test('Property 7: cross-instance broadcast delivers exactly once per connection', async () => {
  await fc.assert(
    fc.asyncProperty(p7Arb, async (scenario) => {
      const { numInstances, room, conns, outsidePerInstance, publisher } = scenario;
      const instances = await buildCluster(numInstances, room);
      try {
        // In-room connections: connection j joins on its instance under its member.
        const inRoom: FakeConnection[] = [];
        for (let j = 0; j < conns.length; j++) {
          const spec = conns[j];
          const conn = new FakeConnection({ id: `in-${j}` });
          inRoom.push(conn);
          await instances[spec.instance].room.join(member(spec.member), conn);
        }

        // Out-of-room connections: opened + bound per instance, never joined.
        const outside: FakeConnection[] = [];
        for (let i = 0; i < numInstances; i++) {
          for (let k = 0; k < outsidePerInstance[i]; k++) {
            const conn = new FakeConnection({ id: `out-${i}-${k}` });
            instances[i].realtime.bind(conn, member(k));
            outside.push(conn);
          }
        }

        // Resolve exclusions against the concrete generated connections/members.
        const exceptConnIdx =
          scenario.exceptConnRaw === undefined
            ? undefined
            : scenario.exceptConnRaw % conns.length;
        const exceptMemberIdx = scenario.exceptMemberRaw;

        const options: BroadcastOptions = {};
        if (exceptConnIdx !== undefined) options.exceptConnId = inRoom[exceptConnIdx].id;
        if (exceptMemberIdx !== undefined) options.exceptMemberId = memberId(exceptMemberIdx);

        // Drop presence:join noise so we assert purely on the broadcast.
        for (const conn of inRoom) conn.clear();
        for (const conn of outside) conn.clear();

        const type = 'chat';
        const payload = { text: 'hello-cluster', n: conns.length };
        await instances[publisher].room.broadcast({ type, payload }, options);

        // Each in-room connection is eligible unless it is the excluded
        // connection or belongs to the excluded member. Every eligible
        // connection — on the publisher instance AND on every peer — must
        // receive the message exactly once (Req 7.6, 13.1); excluded ones zero.
        for (let j = 0; j < inRoom.length; j++) {
          const excludedByConn = exceptConnIdx !== undefined && j === exceptConnIdx;
          const excludedByMember =
            exceptMemberIdx !== undefined && conns[j].member === exceptMemberIdx;
          const eligible = !excludedByConn && !excludedByMember;

          const received = inRoom[j].eventsOfType(type);
          if (eligible) {
            assert.equal(
              received.length,
              1,
              `eligible connection ${inRoom[j].id} (instance ${conns[j].instance}) must receive the broadcast exactly once`,
            );
            assert.deepEqual(
              received[0].payload,
              payload,
              `eligible connection ${inRoom[j].id} must receive the exact payload`,
            );
          } else {
            assert.equal(
              received.length,
              0,
              `excluded connection ${inRoom[j].id} must not receive the broadcast`,
            );
          }
        }

        // Connections outside the room never receive the broadcast (Req 7.1, 7.6).
        for (const conn of outside) {
          assert.equal(
            conn.eventsOfType(type).length,
            0,
            `out-of-room connection ${conn.id} must never receive the broadcast`,
          );
        }
      } finally {
        await closeCluster(instances);
      }
    }),
    { numRuns: 100 },
  );
});
