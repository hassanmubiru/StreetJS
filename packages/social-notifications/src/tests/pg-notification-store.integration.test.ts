// pg-notification-store.integration.test.ts
// Integration tests for the Postgres-backed notification store. Gated on PG env.
//
//   PG_HOST=127.0.0.1 PG_PORT=5433 PG_USER=street \
//   PG_PASSWORD=street_secret PG_DATABASE=street_test \
//   npm run test -w packages/social-notifications

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PgPool } from 'streetjs';
import {
  NotificationService,
  PgNotificationStore,
  SOCIAL_NOTIFICATIONS_MIGRATION_SQL,
} from '../index.js';

const HAS_PG = Boolean(process.env['PG_HOST'] && process.env['PG_DATABASE']);

describe('PgNotificationStore (live Postgres)', { skip: !HAS_PG ? 'PG_* env not set' : false }, () => {
  let pool: PgPool;
  let svc: NotificationService;

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
    await pool.query(SOCIAL_NOTIFICATIONS_MIGRATION_SQL);
    svc = new NotificationService({ store: new PgNotificationStore(pool) });
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE street_social_notifications RESTART IDENTITY');
  });

  after(async () => {
    await pool.query('DROP TABLE IF EXISTS street_social_notifications');
    await pool.close();
  });

  it('persists notifications with payload and lists newest-first', async () => {
    await svc.onFollow('ada', 'bob');
    const r = await svc.onReaction('ada', 'cat', 'post1', '🔥');
    assert.ok(r);
    const list = await svc.list('ada');
    assert.deepEqual(list.map((n) => n.type), ['reaction', 'follow']);
    assert.deepEqual(list[0]!.data, { reaction: '🔥' });
    assert.equal(list[0]!.subjectId, 'post1');
  });

  it('tracks unread counts, markRead, and markAllRead', async () => {
    const n1 = (await svc.onFollow('ada', 'b'))!;
    await svc.onFollow('ada', 'c');
    await svc.onFollow('ada', 'd');
    assert.equal(await svc.unreadCount('ada'), 3);
    assert.equal(await svc.markRead(n1.id, 'ada'), true);
    assert.equal(await svc.markRead(n1.id, 'ada'), false);
    assert.equal(await svc.unreadCount('ada'), 2);
    assert.equal(await svc.markAllRead('ada'), 2);
    assert.equal(await svc.unreadCount('ada'), 0);
  });

  it('unreadOnly filter, recipient-scoped delete, and self-suppression', async () => {
    await svc.onFollow('ada', 'b');
    assert.equal(await svc.onFollow('ada', 'ada'), null); // self-suppressed
    const list = await svc.list('ada', { unreadOnly: true });
    assert.equal(list.length, 1);
    assert.equal(await svc.delete(list[0]!.id, 'intruder'), false);
    assert.equal(await svc.delete(list[0]!.id, 'ada'), true);
    assert.equal(await svc.unreadCount('ada'), 0);
  });

  it('paginates with the before cursor', async () => {
    for (let i = 0; i < 4; i++) await svc.notify({ recipientId: 'ada', type: 't', actorId: `a${i}` });
    const page1 = await svc.list('ada', { limit: 2 });
    assert.equal(page1.length, 2);
    const page2 = await svc.list('ada', { limit: 2, before: page1[1]!.seq });
    assert.ok(page2.every((n) => n.seq < page1[1]!.seq));
    assert.equal(page2.length, 2);
  });
});
