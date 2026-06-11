// tests/dating-moderation.test.ts
// Example-based unit tests for the @streetjs/dating-moderation package (R11.4).
//
// These verify the package's blocking and reporting surface delegates correctly
// to the core ModerationToolkit:
//   - reportUser stores and queues a report; resolveReport clears it (R8.1/R8.6).
//   - blockUser records the block and canMessage reflects it directionally (R8.2/R8.3).
//   - isBlockedBetween detects a block in either direction.
//   - auditLog surfaces the append-only core audit log (R8.5/R8.7).
//   - An injected store/clock and an injected toolkit are both honored.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DatingModeration,
  ModerationToolkit,
  InMemoryModerationStore,
  UnknownReportError,
} from '../index.js';
import type { Clock } from '../index.js';

const FIXED_NOW = 1_700_000_000_000;
const fixedClock: Clock = () => FIXED_NOW;

function make(): DatingModeration {
  return new DatingModeration({ clock: fixedClock });
}

describe('DatingModeration reporting (R11.4)', () => {
  it('stores a report and places it in the review queue', async () => {
    const mod = make();

    const report = await mod.reportUser('alice', 'bob', 'inappropriate photos');

    assert.equal(report.reporter, 'alice');
    assert.equal(report.target, 'bob');
    assert.equal(report.reason, 'inappropriate photos');
    assert.equal(report.createdAt, FIXED_NOW);
    assert.ok(report.id);

    const queue = await mod.reviewQueue();
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, report.id);
  });

  it('removes a report from the queue once resolved', async () => {
    const mod = make();
    const report = await mod.reportUser('alice', 'bob', 'spam');

    await mod.resolveReport('mod-1', report.id, 'warned');

    assert.equal((await mod.reviewQueue()).length, 0);
  });

  it('rejects resolving an unknown report id', async () => {
    const mod = make();

    await assert.rejects(
      () => mod.resolveReport('mod-1', 'nope', 'banned'),
      (err: unknown) =>
        err instanceof UnknownReportError && (err as UnknownReportError).reportId === 'nope',
    );
  });
});

describe('DatingModeration blocking (R11.4, composes R8.2/R8.3)', () => {
  it('permits messaging when no block exists', async () => {
    const mod = make();
    assert.equal(await mod.canMessage('alice', 'bob'), true);
    assert.equal(await mod.canMessage('bob', 'alice'), true);
  });

  it('prevents the blocked user from messaging the blocker', async () => {
    const mod = make();

    await mod.blockUser('alice', 'bob'); // alice blocks bob

    // bob can no longer message alice; alice can still message bob.
    assert.equal(await mod.canMessage('bob', 'alice'), false);
    assert.equal(await mod.canMessage('alice', 'bob'), true);
  });

  it('detects a block in either direction with isBlockedBetween', async () => {
    const mod = make();
    assert.equal(await mod.isBlockedBetween('alice', 'bob'), false);

    await mod.blockUser('bob', 'alice'); // bob blocks alice

    assert.equal(await mod.isBlockedBetween('alice', 'bob'), true);
    assert.equal(await mod.isBlockedBetween('bob', 'alice'), true);
  });
});

describe('DatingModeration audit log (composes R8.5/R8.7)', () => {
  it('records an append-only event for each block and report', async () => {
    const mod = make();

    await mod.reportUser('alice', 'bob', 'spam');
    await mod.blockUser('carol', 'dave');

    const log = await mod.auditLog();
    assert.equal(log.length, 2);
    assert.deepEqual(
      log.map((e) => e.action),
      ['report', 'block'],
    );
    // Events are frozen — no public mutation path.
    for (const e of log) assert.ok(Object.isFrozen(e));
  });
});

describe('DatingModeration injection', () => {
  it('honors an injected store', async () => {
    const store = new InMemoryModerationStore();
    const mod = new DatingModeration({ store, clock: fixedClock });

    await mod.blockUser('alice', 'bob');

    assert.equal(await store.isBlocked('alice', 'bob'), true);
  });

  it('wraps an injected toolkit and exposes it', async () => {
    const toolkit = new ModerationToolkit(new InMemoryModerationStore(), { clock: fixedClock });
    const mod = new DatingModeration({ toolkit });

    assert.equal(mod.moderation, toolkit);

    await mod.reportUser('alice', 'bob', 'spam');
    assert.equal((await toolkit.queue()).length, 1);
  });
});
