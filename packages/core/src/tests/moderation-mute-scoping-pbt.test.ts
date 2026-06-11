// tests/moderation-mute-scoping-pbt.test.ts
// Property-based test for the Moderation_Toolkit (Phase 7, Requirement 8).
//
// Feature: consumer-platform-security, Property 19 — Mute scoping.
// Validates: Requirements 8.4
//
// This file proves, across arbitrary sets of content items and mute
// relationships, that muting is scoped strictly to the muting user's delivered
// view (R8.4):
//   - content from a user the recipient has muted is suppressed from THAT
//     recipient's `deliverable(...)` view, and
//   - the same content remains deliverable to every other recipient who has not
//     muted its sender.
//
// The invariant is asserted directly: for every recipient, `deliverable` must
// return exactly the items whose sender the recipient has NOT muted, in their
// original order (no reordering, no dropping of un-muted items, no leaking of
// muted ones). A cross-recipient check makes the "preserved for others" half of
// the scoping property explicit: an item suppressed for the muting user is still
// delivered to a different recipient who did not mute that sender.
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is exercised across many generated inputs alongside the
// example/edge-case unit tests for the toolkit.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { ModerationToolkit, InMemoryModerationStore } from '../security/moderation.js';

const NUM_RUNS = 200;

// Small, fixed user id space so mutes and senders collide often, exercising the
// scoping logic densely rather than over a sparse, near-disjoint id space.
const USERS = ['u0', 'u1', 'u2', 'u3', 'u4'] as const;
type UserId = (typeof USERS)[number];

const userArb = fc.constantFrom(...USERS);

// A content item carries its sender plus a unique tag so identical-sender items
// remain individually distinguishable when we compare delivered vs. expected.
interface Item {
  readonly sender: UserId;
  readonly tag: number;
}

// Items: each gets a stable, unique tag (its index) assigned after generation.
const itemsArb: fc.Arbitrary<Item[]> = fc
  .array(userArb, { maxLength: 20 })
  .map((senders) => senders.map((sender, tag) => ({ sender, tag })));

// Mute relationships: ordered (muter, muted) pairs, deduplicated via the store.
const mutesArb: fc.Arbitrary<Array<[UserId, UserId]>> = fc.array(
  fc.tuple(userArb, userArb),
  { maxLength: 12 },
);

// ── Property 19: mute scoping (R8.4) ────────────────────────────────────────────

// Feature: consumer-platform-security, Property 19: Mute scoping
// Validates: Requirements 8.4
describe('Property 19: mute scoping', () => {
  it('suppresses muted senders only for the muting recipient and preserves all other items (R8.4)', async () => {
    await fc.assert(
      fc.asyncProperty(itemsArb, mutesArb, async (items, mutes) => {
        const toolkit = new ModerationToolkit(new InMemoryModerationStore());
        for (const [muter, muted] of mutes) {
          await toolkit.mute(muter, muted);
        }

        // Ground-truth mute relation derived directly from the generated pairs.
        const isMuted = (recipient: UserId, sender: UserId): boolean =>
          mutes.some(([muter, muted]) => muter === recipient && muted === sender);

        for (const recipient of USERS) {
          const delivered = await toolkit.deliverable(recipient, items);

          // The delivered view is exactly the un-muted items, in original order:
          // muted senders are suppressed, every other item is preserved verbatim.
          const expected = items.filter((item) => !isMuted(recipient, item.sender));
          assert.deepEqual(delivered, expected);

          // No item from a muted sender ever leaks into the recipient's view.
          for (const item of delivered) {
            assert.ok(
              !isMuted(recipient, item.sender),
              `muted sender ${item.sender} leaked to recipient ${recipient}`,
            );
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps a sender muted by one recipient deliverable to every other recipient who did not mute them (R8.4)', async () => {
    await fc.assert(
      fc.asyncProperty(itemsArb, mutesArb, async (items, mutes) => {
        const toolkit = new ModerationToolkit(new InMemoryModerationStore());
        for (const [muter, muted] of mutes) {
          await toolkit.mute(muter, muted);
        }

        const isMuted = (recipient: UserId, sender: UserId): boolean =>
          mutes.some(([muter, muted]) => muter === recipient && muted === sender);

        // For every item suppressed for some recipient, confirm it is still
        // delivered to each other recipient who has not muted that sender —
        // muting is scoped to the muting user alone.
        for (const muter of USERS) {
          const mutedView = await toolkit.deliverable(muter, items);
          const suppressed = items.filter((item) => !mutedView.includes(item));

          for (const item of suppressed) {
            for (const other of USERS) {
              if (other === muter) continue;
              const otherView = await toolkit.deliverable(other, items);
              if (!isMuted(other, item.sender)) {
                assert.ok(
                  otherView.includes(item),
                  `item from ${item.sender} suppressed for ${muter} should remain deliverable to ${other}`,
                );
              }
            }
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
