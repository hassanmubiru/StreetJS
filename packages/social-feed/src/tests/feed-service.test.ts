// feed-service.test.ts
// Example/edge-case unit tests for the feed against the in-memory store and a
// simple in-memory follow source.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FollowService } from '@streetjs/social-users';
import { FeedService } from '../index.js';

/** A monotonic clock so created order is deterministic in assertions. */
function tick() {
  let t = 0;
  return () => ++t;
}

describe('FeedService (in-memory)', () => {
  it('publishes posts and returns them in a user timeline newest-first', async () => {
    const follows = new FollowService();
    const feed = new FeedService({ followees: follows, now: tick() });
    const p1 = await feed.publish({ authorId: 'ada', text: 'first' });
    const p2 = await feed.publish({ authorId: 'ada', text: 'second' });
    assert.ok(p2.seq > p1.seq);
    const tl = await feed.userTimeline('ada');
    assert.deepEqual(tl.map((p) => p.text), ['second', 'first']);
  });

  it('home timeline merges posts from followed users, newest first', async () => {
    const follows = new FollowService();
    const feed = new FeedService({ followees: follows, now: tick(), includeSelf: false });
    await follows.follow('reader', 'ada');
    await follows.follow('reader', 'bob');

    await feed.publish({ authorId: 'ada', text: 'a1' });
    await feed.publish({ authorId: 'bob', text: 'b1' });
    await feed.publish({ authorId: 'carol', text: 'c1' }); // not followed
    await feed.publish({ authorId: 'ada', text: 'a2' });

    const home = await feed.homeTimeline('reader');
    assert.deepEqual(home.map((p) => p.text), ['a2', 'b1', 'a1']);
  });

  it('includeSelf controls whether own posts appear in the home timeline', async () => {
    const follows = new FollowService();
    const feedWithSelf = new FeedService({ followees: follows, now: tick(), includeSelf: true });
    await feedWithSelf.publish({ authorId: 'solo', text: 'hello' });
    assert.deepEqual((await feedWithSelf.homeTimeline('solo')).map((p) => p.text), ['hello']);

    const follows2 = new FollowService();
    const feedNoSelf = new FeedService({ followees: follows2, now: tick(), includeSelf: false });
    await feedNoSelf.publish({ authorId: 'solo', text: 'hello' });
    assert.deepEqual(await feedNoSelf.homeTimeline('solo'), []);
  });

  it('paginates with limit and the before cursor', async () => {
    const follows = new FollowService();
    const feed = new FeedService({ followees: follows, now: tick() });
    const posts = [];
    for (let i = 0; i < 5; i++) posts.push(await feed.publish({ authorId: 'ada', text: `p${i}` }));

    const page1 = await feed.userTimeline('ada', { limit: 2 });
    assert.deepEqual(page1.map((p) => p.text), ['p4', 'p3']);
    const page2 = await feed.userTimeline('ada', { limit: 2, before: page1[page1.length - 1]!.seq });
    assert.deepEqual(page2.map((p) => p.text), ['p2', 'p1']);
  });

  it('delete is author-scoped and idempotent', async () => {
    const follows = new FollowService();
    const feed = new FeedService({ followees: follows, now: tick() });
    const post = await feed.publish({ authorId: 'ada', text: 'oops' });
    assert.equal(await feed.delete(post.id, 'bob'), false); // not the author
    assert.equal(await feed.delete(post.id, 'ada'), true);
    assert.equal(await feed.delete(post.id, 'ada'), false); // already gone
    assert.equal(await feed.get(post.id), undefined);
  });

  it('rejects empty author/text and missing follow source', async () => {
    const follows = new FollowService();
    const feed = new FeedService({ followees: follows });
    await assert.rejects(() => feed.publish({ authorId: '', text: 'x' }), /authorId must be a non-empty string/);
    await assert.rejects(() => feed.publish({ authorId: 'ada', text: '   ' }), /text must be a non-empty string/);
    assert.throws(() => new FeedService({} as never), /FolloweeSource/);
  });
});
