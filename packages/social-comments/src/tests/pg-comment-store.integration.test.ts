// pg-comment-store.integration.test.ts
// Integration tests for the Postgres-backed comment store. Gated on PG env.
//
//   PG_HOST=127.0.0.1 PG_PORT=5433 PG_USER=street \
//   PG_PASSWORD=street_secret PG_DATABASE=street_test \
//   npm run test -w packages/social-comments

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PgPool } from 'streetjs';
import { CommentService, PgCommentStore, SOCIAL_COMMENTS_MIGRATION_SQL } from '../index.js';

const HAS_PG = Boolean(process.env['PG_HOST'] && process.env['PG_DATABASE']);

describe('PgCommentStore (live Postgres)', { skip: !HAS_PG ? 'PG_* env not set' : false }, () => {
  let pool: PgPool;
  let svc: CommentService;

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
    await pool.query(SOCIAL_COMMENTS_MIGRATION_SQL);
    svc = new CommentService({ store: new PgCommentStore(pool) });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE street_social_comments RESTART IDENTITY');
    await pool.query('TRUNCATE street_social_comment_mentions');
    await pool.query('TRUNCATE street_social_comment_reactions');
  });

  after(async () => {
    await pool.query('DROP TABLE IF EXISTS street_social_comment_reactions');
    await pool.query('DROP TABLE IF EXISTS street_social_comment_mentions');
    await pool.query('DROP TABLE IF EXISTS street_social_comments');
    await pool.close();
  });

  it('persists comments, threads, replies, and mentions', async () => {
    const root = await svc.comment({ subjectId: 'p', authorId: 'ada', text: 'hello @bob' });
    assert.deepEqual(root.mentions, ['bob']);
    const reply = await svc.comment({ subjectId: 'p', authorId: 'bob', text: 'hi @Ada', parentId: root.id });

    assert.deepEqual((await svc.thread('p')).map((c) => c.text), ['hello @bob', 'hi @Ada']);
    assert.deepEqual((await svc.replies(root.id)).map((c) => c.id), [reply.id]);
    assert.deepEqual((await svc.mentionsOf('ada')).map((c) => c.id), [reply.id]);
    assert.deepEqual((await svc.mentionsOf('bob')).map((c) => c.id), [root.id]);
  });

  it('toggles reactions and counts them, persisted', async () => {
    const c = await svc.comment({ subjectId: 'p', authorId: 'ada', text: 'nice' });
    assert.equal(await svc.react(c.id, 'bob', 'like'), true);
    assert.equal(await svc.react(c.id, 'bob', 'like'), false);
    assert.equal(await svc.react(c.id, 'cat', 'like'), true);
    assert.deepEqual(await svc.reactions(c.id), { like: 2 });
    assert.equal(await svc.unreact(c.id, 'bob', 'like'), true);
    assert.deepEqual(await svc.reactions(c.id), { like: 1 });
  });

  it('author-scoped delete clears mentions and reactions', async () => {
    const c = await svc.comment({ subjectId: 'p', authorId: 'ada', text: 'bye @bob' });
    await svc.react(c.id, 'bob', 'like');
    assert.equal(await svc.delete(c.id, 'intruder'), false);
    assert.equal(await svc.delete(c.id, 'ada'), true);
    assert.equal(await svc.get(c.id), undefined);
    assert.deepEqual(await svc.mentionsOf('bob'), []);
    assert.deepEqual(await svc.reactions(c.id), {});
  });

  it('paginates a thread with the after cursor', async () => {
    const created = [];
    for (let i = 0; i < 4; i++) {
      created.push(await svc.comment({ subjectId: 'p', authorId: 'ada', text: `c${i}` }));
    }
    const page1 = await svc.thread('p', { limit: 2 });
    assert.deepEqual(page1.map((c) => c.text), ['c0', 'c1']);
    const page2 = await svc.thread('p', { limit: 2, after: page1[1]!.seq });
    assert.deepEqual(page2.map((c) => c.text), ['c2', 'c3']);
  });
});
