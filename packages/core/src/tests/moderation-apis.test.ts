// tests/moderation-apis.test.ts
// Example-based unit tests for the Moderation_Toolkit report/queue/resolve/block
// APIs (Phase 7, Requirement 8).
//
// Covers:
//   - A submitted report is stored and placed in the moderation queue (R8.1).
//   - Blocking records the block relationship (R8.2).
//   - `canMessage` reflects an existing block: while A has blocked B, B cannot
//     message A, and the relationship is directional (R8.3).
//   - The queue can be listed and each report resolved, after which it leaves
//     the pending queue (R8.6).
//
// A fixed clock is injected so created/resolved timestamps are deterministic,
// mirroring the sibling moderation/abuse tests. The companion mute-scoping (P19)
// and audit-immutability (P20) properties live in their own *-pbt.test.ts files.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ModerationToolkit,
  InMemoryModerationStore,
  UnknownReportError,
  type Clock,
} from '../security/moderation.js';

// A fixed clock pins every createdAt/resolvedAt timestamp to a known value so
// the tests can assert on them directly.
const FIXED_NOW = 1_700_000_000_000;
const fixedClock: Clock = () => FIXED_NOW;

/** Build a toolkit over a fresh in-memory store with the fixed clock. */
function makeToolkit(): { toolkit: ModerationToolkit; store: InMemoryModerationStore } {
  const store = new InMemoryModerationStore();
  const toolkit = new ModerationToolkit(store, { clock: fixedClock });
  return { toolkit, store };
}

// ── R8.1: report is stored and queued ───────────────────────────────────────

describe('ModerationToolkit.report (R8.1)', () => {
  it('stores the submitted report and places it in the moderation queue', async () => {
    const { toolkit, store } = makeToolkit();

    const report = await toolkit.report('alice', 'bob', 'spam');

    // The returned report carries the submitted fields and a fixed timestamp.
    assert.equal(report.reporter, 'alice');
    assert.equal(report.target, 'bob');
    assert.equal(report.reason, 'spam');
    assert.equal(report.createdAt, FIXED_NOW);
    assert.ok(report.id, 'report should be assigned an id');
    assert.equal(report.resolution, undefined);

    // It is persisted and retrievable by id.
    const stored = await store.getReport(report.id);
    assert.ok(stored, 'report should be stored');
    assert.equal(stored?.reporter, 'alice');
    assert.equal(stored?.target, 'bob');

    // It appears in the moderation queue.
    const queue = await toolkit.queue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, report.id);
  });

  it('queues multiple reports independently', async () => {
    const { toolkit } = makeToolkit();

    const r1 = await toolkit.report('alice', 'bob', 'spam');
    const r2 = await toolkit.report('carol', 'dave', 'harassment');

    const queue = await toolkit.queue();
    const ids = queue.map((r) => r.id).sort();
    assert.deepEqual(ids, [r1.id, r2.id].sort());
    assert.notEqual(r1.id, r2.id);
  });
});

// ── R8.2: block records the relationship ────────────────────────────────────

describe('ModerationToolkit.block (R8.2)', () => {
  it('records the block relationship in the store', async () => {
    const { toolkit, store } = makeToolkit();

    await toolkit.block('alice', 'bob');

    assert.equal(await store.isBlocked('alice', 'bob'), true);
  });

  it('records blocks directionally — blocking is not symmetric', async () => {
    const { toolkit, store } = makeToolkit();

    await toolkit.block('alice', 'bob');

    // alice→bob recorded, but bob→alice is not implied.
    assert.equal(await store.isBlocked('alice', 'bob'), true);
    assert.equal(await store.isBlocked('bob', 'alice'), false);
  });
});

// ── R8.3: canMessage reflects an existing block ─────────────────────────────

describe('ModerationToolkit.canMessage (R8.3)', () => {
  it('permits messaging when no block exists', async () => {
    const { toolkit } = makeToolkit();

    assert.equal(await toolkit.canMessage('alice', 'bob'), true);
    assert.equal(await toolkit.canMessage('bob', 'alice'), true);
  });

  it('prevents the blocked user from messaging the blocker (R8.3)', async () => {
    const { toolkit } = makeToolkit();

    // alice blocks bob → bob may no longer message alice.
    await toolkit.block('alice', 'bob');

    assert.equal(await toolkit.canMessage('bob', 'alice'), false);
  });

  it('still allows the blocker to message in the other direction', async () => {
    const { toolkit } = makeToolkit();

    // alice blocks bob. The block only stops bob→alice; alice→bob is unaffected
    // unless bob has independently blocked alice.
    await toolkit.block('alice', 'bob');

    assert.equal(await toolkit.canMessage('alice', 'bob'), true);
  });

  it('reflects each block independently when both users block each other', async () => {
    const { toolkit } = makeToolkit();

    await toolkit.block('alice', 'bob');
    await toolkit.block('bob', 'alice');

    assert.equal(await toolkit.canMessage('bob', 'alice'), false);
    assert.equal(await toolkit.canMessage('alice', 'bob'), false);
  });
});

// ── R8.6: queue listing and resolution ──────────────────────────────────────

describe('ModerationToolkit.queue and resolve (R8.6)', () => {
  it('removes a report from the pending queue once resolved', async () => {
    const { toolkit, store } = makeToolkit();

    const report = await toolkit.report('alice', 'bob', 'spam');
    assert.equal((await toolkit.queue()).length, 1);

    await toolkit.resolve('mod-1', report.id, 'banned');

    // The resolved report leaves the pending queue.
    assert.equal((await toolkit.queue()).length, 0);

    // The resolution is recorded on the stored report.
    const stored = await store.getReport(report.id);
    assert.ok(stored?.resolution, 'resolution should be recorded');
    assert.equal(stored?.resolution?.moderator, 'mod-1');
    assert.equal(stored?.resolution?.outcome, 'banned');
    assert.equal(stored?.resolution?.resolvedAt, FIXED_NOW);
  });

  it('leaves unresolved reports in the queue when others are resolved', async () => {
    const { toolkit } = makeToolkit();

    const r1 = await toolkit.report('alice', 'bob', 'spam');
    const r2 = await toolkit.report('carol', 'dave', 'harassment');

    await toolkit.resolve('mod-1', r1.id, 'dismissed');

    const queue = await toolkit.queue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, r2.id);
  });

  it('throws UnknownReportError when resolving an unknown report id', async () => {
    const { toolkit } = makeToolkit();

    await assert.rejects(
      () => toolkit.resolve('mod-1', 'does-not-exist', 'banned'),
      (err: unknown) =>
        err instanceof UnknownReportError && (err as UnknownReportError).reportId === 'does-not-exist',
    );
  });
});
