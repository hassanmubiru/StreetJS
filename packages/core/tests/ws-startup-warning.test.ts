// tests/ws-startup-warning.test.ts
// Example tests for the unauthenticated-WebSocket-server startup warning (F-R1).
// Uses ONLY node:test + node:assert/strict. The warning is emitted in the
// StreetWebSocketServer constructor when NODE_ENV === 'production' AND no `authFn`
// option is supplied.
//
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.6
//   4.1 — production + no authFn => emit a startup warning.
//   4.2 — non-production + no authFn => NO production warning.
//   4.3 — authFn present => NO unauthenticated-server warning.
//   4.4 — when the warning is emitted, the server still starts and is usable.
//   4.6 — the warning identifies the finding (F-R1) and the `authFn` remediation.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { StreetWebSocketServer } from '../src/websocket/server.js';

// ---- console.warn spy ------------------------------------------------------

const originalWarn = console.warn;
let warnings: string[] = [];

/** Replace console.warn with a capturing spy that records each call's message. */
function installWarnSpy(): void {
  warnings = [];
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };
}

function restoreWarnSpy(): void {
  console.warn = originalWarn;
}

// ---- NODE_ENV save / restore -----------------------------------------------

const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = value;
  }
}

function restoreNodeEnv(): void {
  setNodeEnv(originalNodeEnv);
}

// ---- tests -----------------------------------------------------------------

describe('WebSocket startup warning (F-R1)', () => {
  beforeEach(() => {
    installWarnSpy();
  });

  afterEach(() => {
    restoreWarnSpy();
    restoreNodeEnv();
  });

  it('warns once in production with no authFn, naming F-R1 and the authFn remediation (Req 4.1, 4.6)', async () => {
    setNodeEnv('production');
    const ws = new StreetWebSocketServer();
    try {
      assert.equal(warnings.length, 1, 'exactly one warning should be emitted');
      const message = warnings[0];
      assert.ok(message.includes('F-R1'), 'warning must identify the finding F-R1');
      assert.ok(message.includes('authFn'), 'warning must reference the authFn remediation');
    } finally {
      await ws.close();
    }
  });

  it('does NOT warn outside production when no authFn is supplied (Req 4.2)', async () => {
    setNodeEnv('development');
    const ws = new StreetWebSocketServer();
    try {
      assert.equal(warnings.length, 0, 'no production warning expected outside production');
    } finally {
      await ws.close();
    }
  });

  it('does NOT warn when an authFn is supplied, even in production (Req 4.3)', async () => {
    setNodeEnv('production');
    const ws = new StreetWebSocketServer({ authFn: () => true });
    try {
      assert.equal(warnings.length, 0, 'no unauthenticated-server warning when authFn is present');
    } finally {
      await ws.close();
    }
  });

  it('remains usable after emitting the warning (Req 4.4)', async () => {
    setNodeEnv('production');
    const ws = new StreetWebSocketServer();
    try {
      // The warning fired (precondition for this case).
      assert.equal(warnings.length, 1, 'warning should have been emitted in production without authFn');

      // The server started and exposes a working surface: no connections yet,
      // broadcasting does not throw, and close() resolves cleanly.
      assert.equal(ws.connectionCount, 0, 'a freshly constructed server has no connections');
      assert.doesNotThrow(
        () => ws.broadcast('ping', { hello: 'world' }),
        'broadcast must not throw on a usable server',
      );
      await assert.doesNotReject(ws.close(), 'close() must resolve on a usable server');
    } finally {
      // close() is idempotent enough for the heartbeat-less server; guard anyway.
      await ws.close();
    }
  });
});
