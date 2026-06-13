// pg-follow-store.integration.test.ts
// Integration tests for the Postgres-backed follow store against a live
// database. Gated on PG env vars so the suite stays green DB-free (matching the
// core convention); CI / docker-compose.test-db.yml supply the connection.
//
//   PG_HOST=127.0.0.1 PG_PORT=5433 PG_USER=street \
//   PG_PASSWORD=street_secret PG_DATABASE=street_test \
//   npm run test -w packages/social-users

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PgPool } from 'streetjs';
import { FollowService, PgFollowStore, SOCIAL_FOLLOWS_MIGRATION_SQL } from '../index.js';

const HAS_PG = Boolean(process.env['PG_HOST'] && process.env['PG_DATABASE']);

describe('PgFollowStore (live Postgres)', { skip: !HAS_PG ? 'PG_* env not set' : false }, () => {
  let pool: PgPool;
  let svc: FollowService;

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
    await pool.query(SOCIAL_FOLLOWS_MIGRATION_SQL);
    svc = new FollowService({ store: new PgFollowStore(pool) });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE street_social_follows');
  });

  after(async () => {
    await pool.query('DROP TABLE IF EXISTS street_social_follows');
    await pool.close();
  });

  it('persists follows idempotently and reports edges', async () => {
    assert.equal((await svc.follow('ada', 'lin')).changed, true);
    assert.equal((await svc.follow('ada', 'lin')).changed, false);
    assert.equal(await svc.isFollowing('ada', 'lin'), true);
    assert.equal(await svc.isFollowing('lin', 'ada'), false);
    assert.deepEqual(await svc.counts('lin'), { followers: 1, following: 0 });
    assert.deepEqual(await svc.counts('ada'), { followers: 0, following: 1 });
  });

  it('records mutual follows and lists neighbours in created order', async () => {
    await svc.follow('a', 'target');
    await svc.follow('b', 'target');
    await svc.follow('target', 'a');
    assert.deepEqual(await svc.followers('target'), ['a', 'b']);
    assert.equal(await svc.isMutual('a', 'target'), true);
    assert.equal(await svc.isMutual('b', 'target'), false);
  });

  it('unfollow deletes the row and is idempotent', async () => {
    await svc.follow('ada', 'lin');
    assert.equal((await svc.unfollow('ada', 'lin')).changed, true);
    assert.equal((await svc.unfollow('ada', 'lin')).changed, false);
    assert.equal(await svc.isFollowing('ada', 'lin'), false);
    assert.deepEqual(await svc.counts('lin'), { followers: 0, following: 0 });
  });
});
