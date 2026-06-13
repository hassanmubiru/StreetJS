// notification-service.test.ts
// Example/edge-case unit tests for the notification inbox.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { NotificationService } from '../index.js';

function tick() {
  let t = 0;
  return () => ++t;
}

describe('NotificationService (in-memory)', () => {
  it('creates and lists notifications newest-first', async () => {
    const svc = new NotificationService({ now: tick() });
    await svc.notify({ recipientId: 'ada', type: 'follow', actorId: 'bob' });
    await svc.notify({ recipientId: 'ada', type: 'comment', actorId: 'cat', subjectId: 'post1' });
    const list = await svc.list('ada');
    assert.deepEqual(list.map((n) => n.type), ['comment', 'follow']);
    assert.equal(list[0]!.subjectId, 'post1');
  });

  it('suppresses self-notifications', async () => {
    const svc = new NotificationService({ now: tick() });
    assert.equal(await svc.notify({ recipientId: 'ada', type: 'reaction', actorId: 'ada' }), null);
    assert.deepEqual(await svc.list('ada'), []);
    assert.equal(await svc.unreadCount('ada'), 0);
  });

  it('tracks unread counts and marking read', async () => {
    const svc = new NotificationService({ now: tick() });
    const n1 = (await svc.notify({ recipientId: 'ada', type: 'follow', actorId: 'b' }))!;
    await svc.notify({ recipientId: 'ada', type: 'follow', actorId: 'c' });
    assert.equal(await svc.unreadCount('ada'), 2);

    assert.equal(await svc.markRead(n1.id, 'ada'), true);
    assert.equal(await svc.markRead(n1.id, 'ada'), false); // idempotent
    assert.equal(await svc.markRead(n1.id, 'intruder'), false); // recipient-scoped
    assert.equal(await svc.unreadCount('ada'), 1);
  });

  it('unreadOnly filter and markAllRead', async () => {
    const svc = new NotificationService({ now: tick() });
    await svc.notify({ recipientId: 'ada', type: 'follow', actorId: 'b' });
    await svc.notify({ recipientId: 'ada', type: 'follow', actorId: 'c' });
    await svc.notify({ recipientId: 'ada', type: 'follow', actorId: 'd' });
    assert.equal((await svc.list('ada', { unreadOnly: true })).length, 3);
    assert.equal(await svc.markAllRead('ada'), 3);
    assert.equal(await svc.markAllRead('ada'), 0);
    assert.equal((await svc.list('ada', { unreadOnly: true })).length, 0);
    assert.equal((await svc.list('ada')).length, 3); // still listed, just read
  });

  it('paginates with limit and before cursor', async () => {
    const svc = new NotificationService({ now: tick() });
    const created = [];
    for (let i = 0; i < 5; i++) created.push((await svc.notify({ recipientId: 'ada', type: 't', actorId: `a${i}` }))!);
    const page1 = await svc.list('ada', { limit: 2 });
    assert.equal(page1.length, 2);
    const page2 = await svc.list('ada', { limit: 2, before: page1[1]!.seq });
    assert.ok(page2.every((n) => n.seq < page1[1]!.seq));
  });

  it('delete is recipient-scoped', async () => {
    const svc = new NotificationService({ now: tick() });
    const n = (await svc.notify({ recipientId: 'ada', type: 'follow', actorId: 'b' }))!;
    assert.equal(await svc.delete(n.id, 'intruder'), false);
    assert.equal(await svc.delete(n.id, 'ada'), true);
    assert.equal(await svc.delete(n.id, 'ada'), false);
  });

  it('convenience builders set type and payload', async () => {
    const svc = new NotificationService({ now: tick() });
    const f = (await svc.onFollow('ada', 'bob'))!;
    assert.equal(f.type, 'follow');
    assert.equal(f.actorId, 'bob');
    const m = (await svc.onMention('ada', 'bob', 'post1'))!;
    assert.equal(m.type, 'mention');
    assert.equal(m.subjectId, 'post1');
    const r = (await svc.onReaction('ada', 'bob', 'c1', '👍'))!;
    assert.equal(r.type, 'reaction');
    assert.deepEqual(r.data, { reaction: '👍' });
    // self-notification still suppressed via builders
    assert.equal(await svc.onFollow('ada', 'ada'), null);
  });

  it('rejects empty recipient/type', async () => {
    const svc = new NotificationService();
    await assert.rejects(() => svc.notify({ recipientId: '', type: 't' }), /recipientId/);
    await assert.rejects(() => svc.notify({ recipientId: 'ada', type: '  ' }), /type must be/);
  });
});
