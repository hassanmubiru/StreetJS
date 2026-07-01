// src/tests/auth.test.ts
// Task 6.3 — unit tests for connection-authentication accept/reject wiring
// (Req 9.1, 9.2) and the one-time production unauthenticated-upgrade warning
// (Req 9.5). The auth flow is driven directly through
// `createRealtimeUpgradeAuth(authenticate, bind)` with fake `authenticate` /
// `bind` collaborators and a minimal fake upgrade request, with no network
// socket (Req 16.3). The production warning is exercised by constructing
// `createRealtime` over a fresh no-op `StreetWebSocketServer` with a spied
// `console.warn`.
//
//   - Req 9.1/9.3: WHEN a realtime upgrade authenticates, the resolved Member is
//     associated with the established connection. Verified by resolving a Member
//     from `authenticate`, asserting `authFn(req)` resolves `true`, then invoking
//     the returned `handler(socket, req)` with the SAME `req` and asserting the
//     fake `bind` received that Member for that socket.
//   - Req 9.2: IF the credential is missing/invalid (a `null` result) OR the
//     authenticator throws, THEN `authFn` resolves `false` so the server rejects
//     the upgrade with HTTP 401 and establishes no connection (no handler runs,
//     so `bind` is never called).
//   - Req 9.4: IF authentication succeeded but the identity cannot be carried to
//     the handler, the connection is kept open by binding a `null` Member.
//   - Req 9.5: WHILE `NODE_ENV === 'production'` with no authentication hook,
//     `createRealtime` emits exactly one security warning naming the
//     `unauthenticated-upgrade` finding per WebSocket_Server; it does NOT warn
//     when an `authenticate` hook is configured, nor outside production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';

import { StreetWebSocketServer } from 'streetjs';
import type { StreetSocket, RealtimeConnection } from 'streetjs';
import { createRealtime, FakeConnection } from '../index.js';
import { createRealtimeUpgradeAuth } from '../auth.js';
import type { Member } from '../index.js';

const member = (id: string): Member => ({ id });

/**
 * A minimal fake upgrade request. `authFn` only forwards it to `authenticate`
 * and stashes the resolved Member keyed by this object's identity, so a bare
 * object cast to `IncomingMessage` is sufficient — the SAME reference must be
 * passed to `authFn` and `handler` for the stashed Member to be recovered.
 */
function fakeRequest(): IncomingMessage {
  return {} as unknown as IncomingMessage;
}

/**
 * A recording `bind`: captures every `(conn, member)` association so tests can
 * assert which Member was bound to which connection.
 */
function recordingBind() {
  const calls: Array<{ conn: RealtimeConnection; member: Member | null }> = [];
  const bind = (conn: RealtimeConnection, m: Member | null): void => {
    calls.push({ conn, member: m });
  };
  return { bind, calls };
}

// ── Req 9.1/9.3 — valid credential: accept + associate the resolved Member ─────

test('authFn accepts a valid credential and the handler binds the resolved Member (Req 9.1, 9.3)', async () => {
  const resolved = member('alice');
  const authenticate = async (_req: IncomingMessage): Promise<Member | null> => resolved;
  const { bind, calls } = recordingBind();

  const auth = createRealtimeUpgradeAuth(authenticate, bind);

  const req = fakeRequest();
  // Upgrade-time authentication accepts the connection (Req 9.1).
  assert.equal(await auth.authFn(req), true);

  // Nothing is bound until the connection handler runs.
  assert.equal(calls.length, 0);

  // The server wraps the accepted socket as a StreetSocket before invoking the
  // handler (Req 3.2); a FakeConnection stands in for that socket here.
  const socket = new FakeConnection({ id: 'alice-conn' });
  auth.handler(socket as unknown as StreetSocket, req);

  // The handler associated the resolved Member with THIS socket (Req 9.3).
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.conn, socket);
  assert.equal(calls[0]?.member, resolved);
});

// ── Req 9.2 — missing/invalid credential: reject with no connection ────────────

test('authFn rejects a missing/invalid credential (authenticate returns null) → 401, no connection (Req 9.2)', async () => {
  const authenticate = async (_req: IncomingMessage): Promise<Member | null> => null;
  const { bind, calls } = recordingBind();

  const auth = createRealtimeUpgradeAuth(authenticate, bind);

  // A null result is a failed credential: the upgrade is rejected (server
  // responds HTTP 401 and establishes no connection), so authFn resolves false…
  assert.equal(await auth.authFn(fakeRequest()), false);
  // …and because no connection is established, the handler never runs, so no
  // Member is ever bound.
  assert.equal(calls.length, 0);
});

// ── Req 9.2 — throwing authenticator is treated as a failed credential ─────────

test('authFn rejects when the authenticator throws → 401, no connection (Req 9.2)', async () => {
  const authenticate = async (_req: IncomingMessage): Promise<Member | null> => {
    throw new Error('token verification failed');
  };
  const { bind, calls } = recordingBind();

  const auth = createRealtimeUpgradeAuth(authenticate, bind);

  // A thrown authenticator must not reject the promise; it resolves false so the
  // server rejects the upgrade with HTTP 401 and establishes no connection.
  assert.equal(await auth.authFn(fakeRequest()), false);
  assert.equal(calls.length, 0);
});

// ── Req 9.4 — authenticated but identity not carried across → bind null ────────

test('handler binds a null Member when authentication succeeded but the identity was not stashed (Req 9.4)', async () => {
  const authenticate = async (_req: IncomingMessage): Promise<Member | null> => member('bob');
  const { bind, calls } = recordingBind();

  const auth = createRealtimeUpgradeAuth(authenticate, bind);

  // The handler runs for a DIFFERENT request than the one authFn stashed against
  // (simulating the identity not being carried across). The connection is kept
  // open without a Member association: bind is called with null.
  const socket = new FakeConnection({ id: 'bob-conn' });
  auth.handler(socket as unknown as StreetSocket, fakeRequest());

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.conn, socket);
  assert.equal(calls[0]?.member, null);
});

// ── Req 9.5 — one-time production unauthenticated-upgrade warning ──────────────

/** Replace `console.warn` with a recorder; returns the captured calls + a restore fn. */
function spyConsoleWarn() {
  const calls: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]): void => {
    calls.push(args);
  };
  return { calls, restore: () => { console.warn = original; } };
}

/** Set `process.env.NODE_ENV`, returning a restore fn that reinstates the prior value. */
function withNodeEnv(value: string) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'NODE_ENV');
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = value;
  return () => {
    if (had) process.env.NODE_ENV = previous;
    else delete process.env.NODE_ENV;
  };
}

/**
 * Count the `console.warn` calls that name the facade's `unauthenticated-upgrade`
 * finding. This isolates the facade's own security warning (Req 9.5) from the
 * core `StreetWebSocketServer`'s separate production warning, which uses a
 * distinct message and is emitted independently at server construction.
 */
function countUnauthenticatedUpgrade(calls: unknown[][]): number {
  return calls.filter((args) =>
    args.some((a) => typeof a === 'string' && a.includes('unauthenticated-upgrade')),
  ).length;
}

test('createRealtime warns exactly once naming unauthenticated-upgrade in production with no auth hook (Req 9.5)', async () => {
  const restoreEnv = withNodeEnv('production');
  const spy = spyConsoleWarn();
  try {
    const realtime = createRealtime({ server: new StreetWebSocketServer() });
    try {
      assert.equal(
        countUnauthenticatedUpgrade(spy.calls),
        1,
        'the facade must emit exactly one warning naming the "unauthenticated-upgrade" finding',
      );
    } finally {
      await realtime.close();
    }
  } finally {
    spy.restore();
    restoreEnv();
  }
});

test('createRealtime warns at most once per WebSocket_Server (Req 9.5)', async () => {
  const restoreEnv = withNodeEnv('production');
  const spy = spyConsoleWarn();
  try {
    // A single shared server: constructing two facades over it must warn only once.
    const server = new StreetWebSocketServer();
    const a = createRealtime({ server });
    const b = createRealtime({ server });
    try {
      assert.equal(
        countUnauthenticatedUpgrade(spy.calls),
        1,
        'the one-time warning must fire at most once per server',
      );
    } finally {
      await a.close();
      await b.close();
    }
  } finally {
    spy.restore();
    restoreEnv();
  }
});

test('createRealtime does NOT warn in production when an authenticate hook is configured (Req 9.5)', async () => {
  const restoreEnv = withNodeEnv('production');
  const spy = spyConsoleWarn();
  try {
    const realtime = createRealtime({
      server: new StreetWebSocketServer(),
      authenticate: async () => member('alice'),
    });
    try {
      assert.equal(
        countUnauthenticatedUpgrade(spy.calls),
        0,
        'a configured auth hook must suppress the facade warning',
      );
    } finally {
      await realtime.close();
    }
  } finally {
    spy.restore();
    restoreEnv();
  }
});

test('createRealtime does NOT warn outside production even with no auth hook (Req 9.5)', async () => {
  const restoreEnv = withNodeEnv('development');
  const spy = spyConsoleWarn();
  try {
    const realtime = createRealtime({ server: new StreetWebSocketServer() });
    try {
      assert.equal(
        countUnauthenticatedUpgrade(spy.calls),
        0,
        'no facade warning outside production',
      );
    } finally {
      await realtime.close();
    }
  } finally {
    spy.restore();
    restoreEnv();
  }
});
