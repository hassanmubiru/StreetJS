// src/tests/event-identifiers.test.ts
//
// Task 14.2 — Event-identifier pinning tests (Req 18.4).
//
// The realtime framework is additive over the existing `streetjs` core and MUST
// preserve the built-in channel event identifiers verbatim: `presence:join`,
// `presence:leave`, and `typing` (defined by `ChannelEvents` in
// packages/core/src/websocket/channels.ts). Clients on the wire depend on these
// exact strings, so any rename of a constant's VALUE — not just its exported
// member name — is a breaking change.
//
// This suite pins those identifiers two ways so a drift in either place breaks
// the build:
//   1. Direct assertions that each `ChannelEvents` member equals its expected
//      string literal (catches a change to the constant's value).
//   2. Behavioral assertions driving the fake-connection harness (Req 16) and
//      comparing the RECORDED emitted event `type` against the string literal
//      (not the `ChannelEvents` constant), so even if someone edited both the
//      constant and every internal reference in lockstep, the wire identifier
//      that another connection actually receives is still pinned.
//
// Validates: Requirements 18.4

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ChannelEvents } from 'streetjs';
import { createHarness } from '../index.js';

// ── 1. Direct constant pinning ────────────────────────────────────────────────

test('ChannelEvents identifiers are retained verbatim as string literals', () => {
  // Compared against hard-coded literals (not re-derived from ChannelEvents) so
  // a rename of any value breaks the suite.
  assert.equal(ChannelEvents.PresenceJoin, 'presence:join');
  assert.equal(ChannelEvents.PresenceLeave, 'presence:leave');
  assert.equal(ChannelEvents.Typing, 'typing');
});

// ── 2. Behavioral pinning through the harness ─────────────────────────────────
//
// Each case joins two connections owned by distinct members and asserts that the
// OTHER connection actually receives an event whose recorded `type` string is the
// expected literal. Comparing the recorded string against the literal (rather than
// against `ChannelEvents.*`) means a rename of the constant's value also breaks
// these tests, because the hub would then emit a different wire identifier.

const ROOM = 'room';

test("a newly-present member delivers a 'presence:join' event to the other connection", () => {
  const harness = createHarness();
  try {
    const first = harness.connect({ id: 'c0' });
    const second = harness.connect({ id: 'c1' });

    harness.join(ROOM, 'm0', first);
    // Clear the join noise on `first` before the observed transition.
    first.clear();

    harness.join(ROOM, 'm1', second);

    const received = first.events();
    assert.equal(received.length, 1, 'the other connection receives exactly one event');
    assert.equal(
      received[0].type,
      'presence:join',
      "the emitted event type is the literal 'presence:join'",
    );
  } finally {
    harness.close();
  }
});

test("a newly-absent member delivers a 'presence:leave' event to the remaining connection", () => {
  const harness = createHarness();
  try {
    const first = harness.connect({ id: 'c0' });
    const second = harness.connect({ id: 'c1' });

    harness.join(ROOM, 'm0', first);
    harness.join(ROOM, 'm1', second);
    // Clear presence:join noise; assert only on the leave transition.
    first.clear();

    harness.leave(ROOM, 'm1', second);

    const received = first.events();
    assert.equal(received.length, 1, 'the remaining connection receives exactly one event');
    assert.equal(
      received[0].type,
      'presence:leave',
      "the emitted event type is the literal 'presence:leave'",
    );
  } finally {
    harness.close();
  }
});

test("a typing state change delivers a 'typing' event to the other connection", () => {
  const harness = createHarness();
  try {
    const first = harness.connect({ id: 'c0' });
    const second = harness.connect({ id: 'c1' });

    harness.join(ROOM, 'm0', first);
    harness.join(ROOM, 'm1', second);
    // Clear presence noise; assert only on the typing event.
    first.clear();

    harness.setTyping(ROOM, 'm1', true, second);

    const received = first.events();
    assert.equal(received.length, 1, 'the other connection receives exactly one event');
    assert.equal(
      received[0].type,
      'typing',
      "the emitted event type is the literal 'typing'",
    );
  } finally {
    harness.close();
  }
});
