// src/tests/type-surface.test.ts
// Compile-time type-error assertion test for the @streetjs/realtime public
// surface (Task 1.2). Validates Requirements 1.2 and 1.5:
//   - Req 1.2: every exported symbol carries explicit TypeScript type declarations.
//   - Req 1.5: importing a public symbol with an incorrect argument type surfaces
//     a TypeScript compile-time type error.
//
// Every `@ts-expect-error` below asserts that a wrong-typed usage of a public
// symbol is REJECTED by tsc. This is self-checking: if such a usage ever became
// valid, tsc would report an unused '@ts-expect-error' directive (TS2578) and
// the build — and therefore this test — would fail. The correctly-typed usages
// carry no directive and must compile cleanly.
//
// These checks are purely static: the function hosting them is never invoked at
// runtime (the scaffolded factory throws until later tasks implement it). The
// runtime `node:test` case below only confirms the file compiled and loaded.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRealtime, MemoryAdapter, RealtimePlugin } from '../index.js';
import type { Realtime, Room, Member } from '../index.js';
import type { RealtimeConnection, StreetWebSocketServer } from 'streetjs';

// Ambient, type-only fixtures — these emit no runtime code.
declare const realtime: Realtime;
declare const room: Room;
declare const member: Member;
declare const conn: RealtimeConnection;
declare const server: StreetWebSocketServer;

/**
 * Hosts the static type assertions. Exported so `noUnusedLocals` treats it as
 * used; it is never actually called (all assertions are compile-time only).
 */
export function __publicSurfaceTypeAssertions(): void {
  // ── Realtime.room(name): rejects non-string / wrong-arity names (Req 2.5, 1.5)
  // @ts-expect-error - name must be a string, not a number
  realtime.room(123);
  // @ts-expect-error - name is required
  realtime.room();
  // Correctly typed: a string name is accepted.
  realtime.room('general');

  // ── RealtimeMessage<T>: `type` must be a string and is required (Req 1.5)
  // @ts-expect-error - `type` must be a string, not a number
  void room.broadcast({ type: 123, payload: 'hi' });
  // @ts-expect-error - `type` is a required field of RealtimeMessage
  void room.broadcast({ payload: 'hi' });
  // Correctly typed message.
  void room.broadcast<{ text: string }>({ type: 'message', payload: { text: 'hi' } });

  // ── BroadcastOptions: exclusion ids must be strings (Req 7.2, 7.3, 1.5)
  // @ts-expect-error - exceptConnId must be a string, not a number
  void room.broadcast({ type: 'm', payload: 1 }, { exceptConnId: 123 });
  // Correctly typed options.
  void room.broadcast({ type: 'm', payload: 1 }, { exceptMemberId: 'user-1' });

  // ── Room.join(member, conn): member must be a Member, not an arbitrary value
  // @ts-expect-error - a bare string is not a Member
  void room.join('not-a-member', conn);
  // Correctly typed join.
  void room.join(member, conn);

  // ── createRealtime(options): `server` is required and typed (Req 3.1, 1.5)
  // @ts-expect-error - `server` is a required option
  createRealtime({});
  // @ts-expect-error - typingTtlMs must be a number, not a string
  createRealtime({ server, typingTtlMs: 'later' });
  // Correctly typed options.
  createRealtime({ server });

  // ── RealtimePlugin(options): constructor requires typed options (Req 1.4, 1.5)
  // @ts-expect-error - options are required
  new RealtimePlugin();
  // @ts-expect-error - a number is not a RealtimeOptions
  new RealtimePlugin(123);

  // ── MemoryAdapter.publish: channel must be a string (Req 12.1, 1.5)
  // @ts-expect-error - channel must be a string, not a number
  void new MemoryAdapter().publish(123, { type: 'm', payload: 1 }, {});
}

test('public surface: wrong-typed usages are rejected at compile time', () => {
  // If this file compiled, every `@ts-expect-error` above matched a real type
  // error and every correctly-typed usage type-checked. Confirm the guard loaded.
  assert.equal(typeof __publicSurfaceTypeAssertions, 'function');
});
