// src/tests/typing-ttl.test.ts
// Task 4.4: Unit test for typing-indicator TTL expiry driven by an injected clock.
//
// Validates Requirement 6.3: WHERE a positive typing time-to-live is configured,
// WHEN a Member sets typing to true and does not refresh it, THE Channel_Hub
// SHALL broadcast a `typing` event with `typing: false` for that Member after
// the configured TTL elapses. A TTL of 0 disables auto-clear.
//
// The test uses `createHarness({ typingTtlMs, fakeTimers: true })` so the hub's
// typing TTL is scheduled on the harness's injected `ManualClock`, and
// `harness.advance(ms)` fires the auto-clear deterministically with no real
// timers or network socket (Req 16.3).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHarness } from '../index.js';
import { ChannelEvents } from 'streetjs';

/** Narrowed shape of the `typing` event payload emitted by the hub. */
interface TypingPayload {
  readonly channel: string;
  readonly memberId: string;
  readonly typing: boolean;
}

test('positive typingTtlMs auto-clears typing after the TTL elapses without refresh (Req 6.3)', () => {
  const ttl = 5000;
  const h = createHarness({ typingTtlMs: ttl, fakeTimers: true });
  try {
    const a = h.connect({ id: 'a' });
    const b = h.connect({ id: 'b' });
    h.join('room', 'alice', a);
    h.join('room', 'bob', b);

    // Alice starts typing; the other connection observes `typing: true`.
    h.setTyping('room', 'alice', true, a);
    let typingEvents = b.eventsOfType(ChannelEvents.Typing);
    assert.equal(typingEvents.length, 1);
    assert.deepEqual(typingEvents[0]?.payload, {
      channel: 'room',
      memberId: 'alice',
      typing: true,
    });

    // Just before the TTL: no auto-clear has fired yet.
    h.advance(ttl - 1);
    assert.equal(b.eventsOfType(ChannelEvents.Typing).length, 1);

    // Crossing the TTL boundary without a refresh: an auto-clear fires exactly once.
    h.advance(1);
    typingEvents = b.eventsOfType(ChannelEvents.Typing);
    assert.equal(typingEvents.length, 2);
    const clear = typingEvents[1]?.payload as TypingPayload;
    assert.equal(clear.typing, false);
    assert.equal(clear.channel, 'room');
    assert.equal(clear.memberId, 'alice');

    // No spurious additional events after the single auto-clear.
    h.advance(ttl * 10);
    assert.equal(b.eventsOfType(ChannelEvents.Typing).length, 2);
  } finally {
    h.close();
  }
});

test('typingTtlMs=0 disables auto-clear so no typing:false fires on its own (Req 6.3)', () => {
  const h = createHarness({ typingTtlMs: 0, fakeTimers: true });
  try {
    const a = h.connect({ id: 'a' });
    const b = h.connect({ id: 'b' });
    h.join('room', 'alice', a);
    h.join('room', 'bob', b);

    // Alice starts typing; the other connection observes `typing: true`.
    h.setTyping('room', 'alice', true, a);
    const afterSet = b.eventsOfType(ChannelEvents.Typing);
    assert.equal(afterSet.length, 1);
    assert.equal((afterSet[0]?.payload as TypingPayload).typing, true);

    // Advancing far past any plausible TTL never produces an auto-clear.
    h.advance(1_000_000);
    const afterAdvance = b.eventsOfType(ChannelEvents.Typing);
    assert.equal(afterAdvance.length, 1);
    assert.equal((afterAdvance[0]?.payload as TypingPayload).typing, true);
  } finally {
    h.close();
  }
});
