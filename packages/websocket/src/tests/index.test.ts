import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  StreetSocket,
  StreetWebSocketServer,
  normalizeOrigin,
  deriveSelfOrigin,
  isOriginAllowed,
  SseConnection,
  createSse,
  ChannelHub,
  ChannelEvents,
  WEBSOCKET_SERVER,
} from '../index.js';

test('the public API is exported from the barrel', () => {
  assert.equal(typeof StreetSocket, 'function');
  assert.equal(typeof StreetWebSocketServer, 'function');
  assert.equal(typeof normalizeOrigin, 'function');
  assert.equal(typeof deriveSelfOrigin, 'function');
  assert.equal(typeof isOriginAllowed, 'function');
  assert.equal(typeof SseConnection, 'function');
  assert.equal(typeof createSse, 'function');
  assert.equal(typeof ChannelHub, 'function');
  assert.equal(ChannelEvents.PresenceJoin, 'presence:join');
});

test('WEBSOCKET_SERVER is a stable global symbol', () => {
  assert.equal(WEBSOCKET_SERVER, Symbol.for('@streetjs/websocket:Server'));
});
