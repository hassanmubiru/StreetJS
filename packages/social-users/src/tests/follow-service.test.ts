// follow-service.test.ts
// Example/edge-case unit tests for the follow graph against the in-memory store.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FollowService, InMemoryFollowStore } from '../index.js';

describe('FollowService (in-memory)', () => {
  it('records a directional follow and reports it', async () => {
    const svc = new FollowService();
    const r = await svc.follow('ada', 'lin');
    assert.equal(r.changed, true);
    assert.equal(r.mutual, false);
    assert.equal(await svc.isFollowing('ada', 'lin'), true);
    assert.equal(await svc.isFollowing('lin', 'ada'), false);
  });

  it('is idempotent: following twice does not change the graph again', async () => {
    const svc = new FollowService();
    assert.equal((await svc.follow('ada', 'lin')).changed, true);
    assert.equal((await svc.follow('ada', 'lin')).changed, false);
    assert.deepEqual(await svc.followers('lin'), ['ada']);
    assert.deepEqual((await svc.counts('lin')), { followers: 1, following: 0 });
  });

  it('detects mutual follows order-independently', async () => {
    const svc = new FollowService();
    await svc.follow('ada', 'lin');
    assert.equal(await svc.isMutual('ada', 'lin'), false);
    const r = await svc.follow('lin', 'ada');
    assert.equal(r.mutual, true);
    assert.equal(await svc.isMutual('ada', 'lin'), true);
    assert.equal(await svc.isMutual('lin', 'ada'), true);
  });

  it('unfollow removes the edge and is idempotent', async () => {
    const svc = new FollowService();
    await svc.follow('ada', 'lin');
    assert.equal((await svc.unfollow('ada', 'lin')).changed, true);
    assert.equal(await svc.isFollowing('ada', 'lin'), false);
    assert.equal((await svc.unfollow('ada', 'lin')).changed, false);
  });

  it('rejects self-follow and self-unfollow', async () => {
    const svc = new FollowService();
    await assert.rejects(() => svc.follow('ada', 'ada'), /cannot follow themselves/);
    await assert.rejects(() => svc.unfollow('ada', 'ada'), /cannot unfollow themselves/);
    assert.equal(await svc.isFollowing('ada', 'ada'), false);
    assert.equal(await svc.isMutual('ada', 'ada'), false);
  });

  it('rejects empty ids', async () => {
    const svc = new FollowService();
    await assert.rejects(() => svc.follow('', 'lin'), /followerId must be a non-empty string/);
    await assert.rejects(() => svc.follow('ada', ''), /followeeId must be a non-empty string/);
  });

  it('lists followers and following in insertion order', async () => {
    const store = new InMemoryFollowStore();
    const svc = new FollowService({ store, now: () => 1 });
    await svc.follow('a', 'target');
    await svc.follow('b', 'target');
    await svc.follow('c', 'target');
    assert.deepEqual(await svc.followers('target'), ['a', 'b', 'c']);
    await svc.follow('target', 'x');
    await svc.follow('target', 'y');
    assert.deepEqual(await svc.following('target'), ['x', 'y']);
    assert.deepEqual(await svc.counts('target'), { followers: 3, following: 2 });
  });
});
