// pg-feed-store.integration.test.ts
// Integration tests for the Postgres-backed feed store against a live database.
// Gated on PG env vars (skips DB-free).
//
//   PG_HOST=127.0.0.1 PG_PORT=5433 PG_USER=street \
//   PG_PASSWORD=street_secret PG_DATABASE=street_test \
//   npm run test -w packages/social-feed

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PgPool } from 'streetjs';
import { FollowService } from '@streetjs/social-users';
import { FeedService, PgFeedStore, SOCIAL_POSTS_MIGRATION_SQL } from '../index.js';

const HAS_PG = Boolean(process.env['PG_HOST'] && process.env['PG_DATABASE']);

describe('PgFeedStore (live Postgres)', { skip: !HAS_PG ? 'PG_* env not set' : false }, () => {
  let pool: PgPool;
  let feed: FeedService;
  let follows: FollowService;

  before(async () => {
    pool = new PgPool({
      host: process.env['PG_HOST']!,
      port: Number(process.env['PG_PORT'] ?? 5432),
      user: process.env['PG_USER'] ?? 'street',
      password: process.env['PG_PASSWORD'] ?? '',
      database: process.env['PG_DATABASE']!,
      maxConnections: 4,
      acquireTimeoutMs: 5_000,
    });
    await pool.query(SOCIAL_POSTS_MIGRATION_SQL);
    follows = new FollowService(); // in-memory follow graph is fine for this suite
    feed = new FeedService({ followees: follows, store: new PgFeedStore(pool), includeSelf: false });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE street_social_posts RESTART IDENTITY');
  });

  after(async () => {
    await pool.query('DROP TABLE IF EXISTS street_social_posts');
    await pool.close();
  });

  it('assigns ascending seq and reads a user timeline newest-first', async () => {
    const a = await feed.publish({ authorId: 'ada', text: 'first' });
    const b = await feed.publish({ authorId: 'ada', text: 'second' });
    assert.ok(b.seq > a.seq);
    assert.deepEqual((await feed.userTimeline('ada')).map((p) => p.text), ['second', 'first']);
  });

  it('builds a home timeline from the follow graph, newest-first', async () => {
    await follows.follow('reader', 'ada');
    await follows.follow('reader', 'bob');
    await feed.publish({ authorId: 'ada', text: 'a1' });
    await feed.publish({ authorId: 'carol', text: 'c1' }); // not followed
    await feed.publish({ authorId: 'bob', text: 'b1' });
    assert.deepEqual((await feed.homeTimeline('reader')).map((p) => p.text), ['b1', 'a1']);
  });

  it('paginates with the before cursor and supports author-scoped delete', async () => {
    const created = [];
    for (let i = 0; i < 4; i++) created.push(await feed.publish({ authorId: 'ada', text: `p${i}` }));
    const page1 = await feed.userTimeline('ada', { limit: 2 });
    assert.deepEqual(page1.map((p) => p.text), ['p3', 'p2']);
    const page2 = await feed.userTimeline('ada', { limit: 2, before: page1[1]!.seq });
    assert.deepEqual(page2.map((p) => p.text), ['p1', 'p0']);

    assert.equal(await feed.delete(created[0]!.id, 'bob'), false);
    assert.equal(await feed.delete(created[0]!.id, 'ada'), true);
    assert.equal(await feed.get(created[0]!.id), undefined);
  });
});
