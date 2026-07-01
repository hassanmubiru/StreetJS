// src/tests/backward-compat.test.ts
//
// Task 14.1 — Signature- and behavior-pinning regression tests (Req 18.1, 18.2).
//
// The realtime framework is ADDITIVE over the existing `streetjs` core: it wraps
// `StreetWebSocketServer`, `StreetSocket`, and `ChannelHub` rather than replacing
// them, and MUST NOT change their public surface or their behavior for
// applications that use them directly without the facade. This suite pins that
// contract three ways so any drift is caught mechanically:
//
//   1. Type-level signature pinning (Req 18.1) — exported guard functions assert,
//      at compile time, that each public method's signature is MUTUALLY assignable
//      to a hard-coded pinned signature. Assignability is checked in BOTH
//      directions (real ⊆ pinned via `satisfies`, and pinned ⊆ real via a typed
//      assignment) so a signature that drifts *either* narrower or more permissive
//      breaks `tsc` — and therefore the build and this test.
//
//   2. Runtime shape pinning (Req 18.1) — `node:test` cases assert every pinned
//      public method still exists as a function with the expected arity, and that
//      accessor properties (`closed`, `readyState`, `connectionCount`) remain
//      getters. These read the class prototypes so no live socket is required.
//
//   3. Behavior-unchanged pinning (Req 18.2) — `node:test` cases drive a
//      `ChannelHub` (and the reused connection lifecycle) DIRECTLY, without the
//      Realtime facade, asserting the pre-realtime baseline semantics: ref-counted
//      idempotent presence, insertion-ordered presence lists, scoped publish with
//      exclusions, typing state + events, and close/disconnect removal.
//
// Validates: Requirements 18.1, 18.2

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

import {
  ChannelHub,
  ChannelEvents,
  StreetSocket,
  StreetWebSocketServer,
} from 'streetjs';
import type {
  RealtimeConnection,
  PublishOptions,
  WsHandler,
  RawWsHandler,
  WsServerOptions,
  ChannelHubOptions,
  WsEvent,
} from 'streetjs';

import { FakeConnection } from '../testing.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. TYPE-LEVEL SIGNATURE PINNING (Req 18.1)
//
// These guards are never invoked at runtime; they exist purely so `tsc` verifies
// the pinned signatures. They are `export`ed so `noUnusedLocals` treats them as
// used. Each pin is bidirectional:
//   • `satisfies <Pins>` proves every real method is assignable TO the pinned
//     signature (catches a param/return type that drifted incompatibly).
//   • the `<PinsByReal> = null as unknown as <Pins>` assignment proves every
//     pinned signature is assignable to the real method type (catches a method
//     that became MORE permissive, e.g. a param widened to `unknown`).
// ─────────────────────────────────────────────────────────────────────────────

/** Compile-time pin of the public `ChannelHub` method signatures (Req 18.1). */
export function __pinChannelHubSignatures(hub: ChannelHub): void {
  type HubPins = {
    join: (channel: number, memberId: string, conn: RealtimeConnection) => { newlyPresent: boolean };
    leave: (channel: string, memberId: string, conn: RealtimeConnection) => { nowAbsent: boolean };
    disconnect: (conn: RealtimeConnection) => void;
    bind: (conn: RealtimeConnection & { onClose(cb: () => void): unknown }) => void;
    publish: (channel: string, type: string, payload: unknown, options?: PublishOptions) => void;
    presence: (channel: string) => string[];
    isPresent: (channel: string, memberId: string) => boolean;
    memberCount: (channel: string) => number;
    connectionCount: (channel: string) => number;
    setTyping: (channel: string, memberId: string, typing: boolean, conn?: RealtimeConnection) => void;
    typingMembers: (channel: string) => string[];
    channelNames: () => string[];
  };

  // real ⊆ pinned
  const forward = {
    join: hub.join,
    leave: hub.leave,
    disconnect: hub.disconnect,
    bind: hub.bind,
    publish: hub.publish,
    presence: hub.presence,
    isPresent: hub.isPresent,
    memberCount: hub.memberCount,
    connectionCount: hub.connectionCount,
    setTyping: hub.setTyping,
    typingMembers: hub.typingMembers,
    channelNames: hub.channelNames,
  } satisfies HubPins;

  // pinned ⊆ real
  const backward: {
    join: typeof hub.join;
    leave: typeof hub.leave;
    disconnect: typeof hub.disconnect;
    bind: typeof hub.bind;
    publish: typeof hub.publish;
    presence: typeof hub.presence;
    isPresent: typeof hub.isPresent;
    memberCount: typeof hub.memberCount;
    connectionCount: typeof hub.connectionCount;
    setTyping: typeof hub.setTyping;
    typingMembers: typeof hub.typingMembers;
    channelNames: typeof hub.channelNames;
  } = null as unknown as HubPins;

  // Constructor signature pin: `new ChannelHub(options?)`.
  const ctor: new (options?: ChannelHubOptions) => ChannelHub = ChannelHub;

  void forward;
  void backward;
  void ctor;
}

/** Compile-time pin of the public `StreetSocket` method/accessor signatures (Req 18.1). */
export function __pinStreetSocketSignatures(socket: StreetSocket): void {
  type SocketPins = {
    onClose: (handler: () => void) => StreetSocket;
    on: (event: string, handler: (data: unknown) => void) => StreetSocket;
    off: (event: string, handler: (data: unknown) => void) => StreetSocket;
    emit: (type: string, payload: unknown) => void;
    close: (code?: number, reason?: string) => void;
  };

  // real ⊆ pinned
  const forward = {
    onClose: socket.onClose,
    on: socket.on,
    off: socket.off,
    emit: socket.emit,
    close: socket.close,
  } satisfies SocketPins;

  // pinned ⊆ real
  const backward: {
    onClose: typeof socket.onClose;
    on: typeof socket.on;
    off: typeof socket.off;
    emit: typeof socket.emit;
    close: typeof socket.close;
  } = null as unknown as SocketPins;

  // Accessor / property types are pinned as values.
  const props = {
    id: socket.id,
    closed: socket.closed,
    readyState: socket.readyState,
  } satisfies { id: string; closed: boolean; readyState: number };

  void forward;
  void backward;
  void props;
}

/** Compile-time pin of the public `StreetWebSocketServer` signatures (Req 18.1). */
export function __pinStreetWebSocketServerSignatures(server: StreetWebSocketServer): void {
  type ServerPins = {
    attach: (server: Server, handler: WsHandler) => void;
    attachProtocol: (server: Server, subprotocol: string, handler: RawWsHandler) => void;
    broadcast: (type: string, payload: unknown) => void;
    close: () => Promise<void>;
  };

  // real ⊆ pinned
  const forward = {
    attach: server.attach,
    attachProtocol: server.attachProtocol,
    broadcast: server.broadcast,
    close: server.close,
  } satisfies ServerPins;

  // pinned ⊆ real
  const backward: {
    attach: typeof server.attach;
    attachProtocol: typeof server.attachProtocol;
    broadcast: typeof server.broadcast;
    close: typeof server.close;
  } = null as unknown as ServerPins;

  // `connectionCount` accessor type pin.
  const props = { connectionCount: server.connectionCount } satisfies { connectionCount: number };

  // Constructor signature pin: `new StreetWebSocketServer(options?)`.
  const ctor: new (options?: WsServerOptions) => StreetWebSocketServer = StreetWebSocketServer;

  void forward;
  void backward;
  void props;
  void ctor;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. RUNTIME SHAPE PINNING (Req 18.1)
//
// Confirm each pinned public method still exists as a function with the expected
// arity, and that accessor properties remain getters. Reading the class
// prototypes needs no live socket.
// ─────────────────────────────────────────────────────────────────────────────

interface MethodShape {
  readonly name: string;
  readonly arity: number;
}

function assertMethods(proto: object, ownerLabel: string, methods: readonly MethodShape[]): void {
  for (const { name, arity } of methods) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    assert.ok(descriptor, `${ownerLabel}.${name} must exist on the prototype`);
    assert.equal(
      typeof descriptor!.value,
      'function',
      `${ownerLabel}.${name} must be a method (function)`,
    );
    assert.equal(
      (descriptor!.value as (...args: unknown[]) => unknown).length,
      arity,
      `${ownerLabel}.${name} must keep arity ${arity}`,
    );
  }
}

function assertGetters(proto: object, ownerLabel: string, names: readonly string[]): void {
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    assert.ok(descriptor, `${ownerLabel}.${name} accessor must exist on the prototype`);
    assert.equal(
      typeof descriptor!.get,
      'function',
      `${ownerLabel}.${name} must remain a getter`,
    );
  }
}

test('runtime shape: ChannelHub public methods and arities are unchanged (Req 18.1)', () => {
  assertMethods(ChannelHub.prototype, 'ChannelHub', [
    { name: 'join', arity: 3 },
    { name: 'leave', arity: 3 },
    { name: 'disconnect', arity: 1 },
    { name: 'bind', arity: 1 },
    { name: 'publish', arity: 3 },
    { name: 'presence', arity: 1 },
    { name: 'isPresent', arity: 2 },
    { name: 'memberCount', arity: 1 },
    { name: 'connectionCount', arity: 1 },
    { name: 'setTyping', arity: 4 },
    { name: 'typingMembers', arity: 1 },
    { name: 'channelNames', arity: 0 },
  ]);
});

test('runtime shape: StreetSocket public methods, arities, and accessors are unchanged (Req 18.1)', () => {
  assertMethods(StreetSocket.prototype, 'StreetSocket', [
    { name: 'onClose', arity: 1 },
    { name: 'on', arity: 2 },
    { name: 'off', arity: 2 },
    { name: 'emit', arity: 2 },
    { name: 'close', arity: 0 },
  ]);
  assertGetters(StreetSocket.prototype, 'StreetSocket', ['closed', 'readyState']);
});

test('runtime shape: StreetWebSocketServer public methods, arities, and accessors are unchanged (Req 18.1)', () => {
  assertMethods(StreetWebSocketServer.prototype, 'StreetWebSocketServer', [
    { name: 'attach', arity: 2 },
    { name: 'attachProtocol', arity: 3 },
    { name: 'broadcast', arity: 2 },
    { name: 'close', arity: 0 },
  ]);
  assertGetters(StreetWebSocketServer.prototype, 'StreetWebSocketServer', ['connectionCount']);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. BEHAVIOR-UNCHANGED PINNING (Req 18.2)
//
// Drive a `ChannelHub` DIRECTLY — no facade — using `FakeConnection`s as the
// `RealtimeConnection` transport, and assert the pre-realtime baseline
// semantics the core guarantees.
// ─────────────────────────────────────────────────────────────────────────────

const ROOM = 'room';

/** Recorded event types on a connection, in order (helper for assertions). */
function types(conn: FakeConnection): string[] {
  return conn.events().map((e) => e.type);
}

test('behavior: presence is ref-counted and idempotent per connection (Req 18.2)', () => {
  const hub = new ChannelHub();
  const a1 = new FakeConnection({ id: 'a1' });
  const a2 = new FakeConnection({ id: 'a2' });

  // First connection of member "alice" → newly present.
  assert.deepEqual(hub.join(ROOM, 'alice', a1), { newlyPresent: true });
  // Second connection of the SAME member → not newly present (ref-counted).
  assert.deepEqual(hub.join(ROOM, 'alice', a2), { newlyPresent: false });

  assert.equal(hub.isPresent(ROOM, 'alice'), true);
  assert.equal(hub.memberCount(ROOM), 1, 'a member with two connections counts once');
  assert.equal(hub.connectionCount(ROOM), 2, 'both connections are tracked');

  // Leaving one connection keeps the member present (still one connection left).
  assert.deepEqual(hub.leave(ROOM, 'alice', a1), { nowAbsent: false });
  assert.equal(hub.isPresent(ROOM, 'alice'), true);
  assert.equal(hub.memberCount(ROOM), 1);

  // Leaving the last connection makes the member absent.
  assert.deepEqual(hub.leave(ROOM, 'alice', a2), { nowAbsent: true });
  assert.equal(hub.isPresent(ROOM, 'alice'), false);
  assert.equal(hub.memberCount(ROOM), 0);
});

test('behavior: presence() returns present members in insertion order (Req 18.2)', () => {
  const hub = new ChannelHub();
  const c0 = new FakeConnection({ id: 'c0' });
  const c1 = new FakeConnection({ id: 'c1' });
  const c2 = new FakeConnection({ id: 'c2' });

  hub.join(ROOM, 'm0', c0);
  hub.join(ROOM, 'm1', c1);
  hub.join(ROOM, 'm2', c2);

  assert.deepEqual(hub.presence(ROOM), ['m0', 'm1', 'm2']);
  assert.deepEqual(hub.channelNames(), [ROOM]);
});

test('behavior: presence:join fires only on newly-present and never to the joiner (Req 18.2)', () => {
  const hub = new ChannelHub();
  const observer = new FakeConnection({ id: 'obs' });
  const joiner = new FakeConnection({ id: 'join' });
  const dup = new FakeConnection({ id: 'dup' });

  // Observer already in the room.
  hub.join(ROOM, 'observer', observer);
  observer.clear();

  // New member joins → observer sees exactly one presence:join, joiner sees none.
  hub.join(ROOM, 'joiner', joiner);
  assert.deepEqual(types(observer), [ChannelEvents.PresenceJoin]);
  assert.deepEqual(observer.lastEvent()!.payload, { channel: ROOM, memberId: 'joiner' });
  assert.deepEqual(types(joiner), [], 'the joining connection never receives its own presence event');

  observer.clear();

  // A SECOND connection of the same member is not newly present → no event.
  hub.join(ROOM, 'joiner', dup);
  assert.deepEqual(types(observer), [], 'a duplicate (ref-count) join emits no presence:join');
});

test('behavior: presence:leave fires only when the member becomes absent (Req 18.2)', () => {
  const hub = new ChannelHub();
  const observer = new FakeConnection({ id: 'obs' });
  const c1 = new FakeConnection({ id: 'c1' });
  const c2 = new FakeConnection({ id: 'c2' });

  hub.join(ROOM, 'observer', observer);
  hub.join(ROOM, 'bob', c1);
  hub.join(ROOM, 'bob', c2);
  observer.clear();

  // First of bob's two connections leaves → still present → no presence:leave.
  hub.leave(ROOM, 'bob', c1);
  assert.deepEqual(types(observer), []);

  // Last connection leaves → member absent → exactly one presence:leave.
  hub.leave(ROOM, 'bob', c2);
  assert.deepEqual(types(observer), [ChannelEvents.PresenceLeave]);
  assert.deepEqual(observer.lastEvent()!.payload, { channel: ROOM, memberId: 'bob' });
});

test('behavior: publish delivers to channel members honoring exclusions (Req 18.2)', () => {
  const hub = new ChannelHub();
  const a = new FakeConnection({ id: 'a' });
  const b = new FakeConnection({ id: 'b' });
  const c = new FakeConnection({ id: 'c' });
  const outsider = new FakeConnection({ id: 'outsider' });

  hub.join(ROOM, 'ma', a);
  hub.join(ROOM, 'mb', b);
  hub.join(ROOM, 'mc', c);
  a.clear();
  b.clear();
  c.clear();

  // Deliver to all members; outsider (never joined) receives nothing.
  hub.publish(ROOM, 'msg', { n: 1 });
  assert.deepEqual(a.eventsOfType('msg').length, 1);
  assert.deepEqual(b.eventsOfType('msg').length, 1);
  assert.deepEqual(c.eventsOfType('msg').length, 1);
  assert.deepEqual(outsider.eventsOfType('msg').length, 0);
  assert.deepEqual(a.lastEvent()!.payload, { n: 1 });

  a.clear();
  b.clear();
  c.clear();

  // exceptConnId excludes a single connection.
  hub.publish(ROOM, 'msg', { n: 2 }, { exceptConnId: 'a' } satisfies PublishOptions);
  assert.equal(a.eventsOfType('msg').length, 0);
  assert.equal(b.eventsOfType('msg').length, 1);
  assert.equal(c.eventsOfType('msg').length, 1);

  a.clear();
  b.clear();
  c.clear();

  // exceptMemberId excludes every connection of a member.
  hub.publish(ROOM, 'msg', { n: 3 }, { exceptMemberId: 'mb' } satisfies PublishOptions);
  assert.equal(a.eventsOfType('msg').length, 1);
  assert.equal(b.eventsOfType('msg').length, 0);
  assert.equal(c.eventsOfType('msg').length, 1);
});

test('behavior: publish to an unknown/empty channel is a no-op (Req 18.2)', () => {
  const hub = new ChannelHub();
  // No throw, no delivery — mirrors the baseline no-op contract.
  assert.doesNotThrow(() => hub.publish('nonexistent', 'msg', { n: 1 }));
  assert.deepEqual(hub.presence('nonexistent'), []);
  assert.equal(hub.memberCount('nonexistent'), 0);
});

test('behavior: setTyping emits typing events and tracks typing members (Req 18.2)', () => {
  const hub = new ChannelHub();
  const observer = new FakeConnection({ id: 'obs' });
  const typer = new FakeConnection({ id: 'typer' });

  hub.join(ROOM, 'observer', observer);
  hub.join(ROOM, 'typer', typer);
  observer.clear();
  typer.clear();

  // Typing true → other connection sees a `typing` event; the typer is excluded.
  hub.setTyping(ROOM, 'typer', true, typer);
  assert.deepEqual(types(observer), [ChannelEvents.Typing]);
  assert.deepEqual(observer.lastEvent()!.payload, { channel: ROOM, memberId: 'typer', typing: true } satisfies {
    channel: string;
    memberId: string;
    typing: boolean;
  });
  assert.deepEqual(types(typer), [], 'the typing connection is excluded from its own event');
  assert.deepEqual(hub.typingMembers(ROOM), ['typer']);

  observer.clear();

  // Typing false → another `typing` event and the member is cleared.
  hub.setTyping(ROOM, 'typer', false, typer);
  assert.deepEqual(types(observer), [ChannelEvents.Typing]);
  assert.deepEqual(observer.lastEvent()!.payload, { channel: ROOM, memberId: 'typer', typing: false });
  assert.deepEqual(hub.typingMembers(ROOM), []);
});

test('behavior: bind + connection close removes the connection from every room (Req 18.2)', () => {
  const hub = new ChannelHub();
  const observer = new FakeConnection({ id: 'obs' });
  const leaver = new FakeConnection({ id: 'leaver' });

  hub.join(ROOM, 'observer', observer);
  // Bind the leaver's lifecycle so its close triggers hub cleanup, exactly as a
  // live StreetSocket would.
  hub.bind(leaver);
  hub.join(ROOM, 'leaver', leaver);
  observer.clear();

  assert.equal(hub.isPresent(ROOM, 'leaver'), true);

  // Closing the connection removes it and fires presence:leave to the observer.
  leaver.close();
  assert.equal(hub.isPresent(ROOM, 'leaver'), false);
  assert.equal(hub.memberCount(ROOM), 1);
  assert.deepEqual(types(observer), [ChannelEvents.PresenceLeave]);
  assert.deepEqual(observer.lastEvent()!.payload, { channel: ROOM, memberId: 'leaver' });
});

test('behavior: disconnect removes a connection from all its channels (Req 18.2)', () => {
  const hub = new ChannelHub();
  const observerA = new FakeConnection({ id: 'obsA' });
  const observerB = new FakeConnection({ id: 'obsB' });
  const multi = new FakeConnection({ id: 'multi' });

  hub.join('roomA', 'observerA', observerA);
  hub.join('roomB', 'observerB', observerB);
  hub.join('roomA', 'multi', multi);
  hub.join('roomB', 'multi', multi);
  observerA.clear();
  observerB.clear();

  assert.equal(hub.isPresent('roomA', 'multi'), true);
  assert.equal(hub.isPresent('roomB', 'multi'), true);

  hub.disconnect(multi);

  assert.equal(hub.isPresent('roomA', 'multi'), false);
  assert.equal(hub.isPresent('roomB', 'multi'), false);
  assert.deepEqual(types(observerA), [ChannelEvents.PresenceLeave]);
  assert.deepEqual(types(observerB), [ChannelEvents.PresenceLeave]);
});

// A small compile-marker so the exported type-pin guards are referenced from a
// runtime test too, confirming this module compiled and loaded.
test('signature pins compiled: type-pin guards are present (Req 18.1)', () => {
  const guards: Array<(...args: never[]) => void> = [
    __pinChannelHubSignatures as unknown as (...args: never[]) => void,
    __pinStreetSocketSignatures as unknown as (...args: never[]) => void,
    __pinStreetWebSocketServerSignatures as unknown as (...args: never[]) => void,
  ];
  for (const g of guards) assert.equal(typeof g, 'function');
});

// Reference otherwise type-only imports so `noUnusedLocals`/`noUnusedParameters`
// stay satisfied for the WsEvent contract used by FakeConnection records.
const _wsEventShapePin: (e: WsEvent) => [string, unknown, number] = (e) => [e.type, e.payload, e.ts];
void _wsEventShapePin;
