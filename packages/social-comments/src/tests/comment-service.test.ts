// comment-service.test.ts
// Example/edge-case unit tests for threaded comments, mentions, and reactions.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CommentService, extractMentions } from '../index.js';

function tick() {
  let t = 0;
  return () => ++t;
}

describe('extractMentions', () => {
  it('extracts unique, normalized handles in order', () => {
    assert.deepEqual(extractMentions('hi @Ada and @bob and @ada again'), ['ada', 'bob']);
  });
  it('ignores email-like @ and unsupported chars', () => {
    assert.deepEqual(extractMentions('mail me at ada@example.com'), []);
    assert.deepEqual(extractMentions('start @ok-not'), ['ok']); // stops at hyphen
  });
  it('handles leading mention and punctuation boundaries', () => {
    assert.deepEqual(extractMentions('@lead thanks, @two!'), ['lead', 'two']);
  });
});

describe('CommentService (in-memory)', () => {
  it('adds comments to a subject in chronological order', async () => {
    const svc = new CommentService({ now: tick() });
    await svc.comment({ subjectId: 'post1', authorId: 'ada', text: 'first' });
    await svc.comment({ subjectId: 'post1', authorId: 'bob', text: 'second' });
    await svc.comment({ subjectId: 'post2', authorId: 'cat', text: 'other' });
    const thread = await svc.thread('post1');
    assert.deepEqual(thread.map((c) => c.text), ['first', 'second']);
  });

  it('parses and stores mentions, and resolves mentionsOf', async () => {
    const svc = new CommentService({ now: tick() });
    const c = await svc.comment({ subjectId: 'p', authorId: 'ada', text: 'cc @Bob and @carol' });
    assert.deepEqual(c.mentions, ['bob', 'carol']);
    assert.deepEqual((await svc.mentionsOf('BOB')).map((x) => x.id), [c.id]);
    assert.deepEqual(await svc.mentionsOf('nobody'), []);
  });

  it('supports threaded replies and validates the parent', async () => {
    const svc = new CommentService({ now: tick() });
    const root = await svc.comment({ subjectId: 'p', authorId: 'ada', text: 'root' });
    const reply = await svc.comment({ subjectId: 'p', authorId: 'bob', text: 'reply', parentId: root.id });
    assert.equal(reply.parentId, root.id);
    assert.deepEqual((await svc.replies(root.id)).map((c) => c.text), ['reply']);

    await assert.rejects(
      () => svc.comment({ subjectId: 'p', authorId: 'x', text: 'r', parentId: 'missing' }),
      /does not exist/,
    );
    await assert.rejects(
      () => svc.comment({ subjectId: 'OTHER', authorId: 'x', text: 'r', parentId: root.id }),
      /share its parent's subject/,
    );
  });

  it('toggles reactions idempotently and counts them', async () => {
    const svc = new CommentService({ now: tick() });
    const c = await svc.comment({ subjectId: 'p', authorId: 'ada', text: 'nice' });
    assert.equal(await svc.react(c.id, 'bob', '👍'), true);
    assert.equal(await svc.react(c.id, 'bob', '👍'), false); // idempotent
    assert.equal(await svc.react(c.id, 'cat', '👍'), true);
    assert.equal(await svc.react(c.id, 'bob', '❤️'), true);
    assert.deepEqual(await svc.reactions(c.id), { '👍': 2, '❤️': 1 });
    assert.deepEqual(await svc.reactionsByUser(c.id, 'bob'), ['❤️', '👍'].sort());
    assert.equal(await svc.unreact(c.id, 'bob', '👍'), true);
    assert.equal(await svc.unreact(c.id, 'bob', '👍'), false);
    assert.deepEqual(await svc.reactions(c.id), { '👍': 1, '❤️': 1 });
  });

  it('delete is author-scoped and clears reactions', async () => {
    const svc = new CommentService({ now: tick() });
    const c = await svc.comment({ subjectId: 'p', authorId: 'ada', text: 'oops' });
    await svc.react(c.id, 'bob', '👍');
    assert.equal(await svc.delete(c.id, 'bob'), false); // not author
    assert.equal(await svc.delete(c.id, 'ada'), true);
    assert.equal(await svc.delete(c.id, 'ada'), false); // already gone
    assert.deepEqual(await svc.reactions(c.id), {});
  });

  it('rejects empty fields and oversized text', async () => {
    const svc = new CommentService();
    await assert.rejects(() => svc.comment({ subjectId: '', authorId: 'a', text: 'x' }), /subjectId/);
    await assert.rejects(() => svc.comment({ subjectId: 'p', authorId: 'a', text: '   ' }), /text must be/);
    await assert.rejects(
      () => svc.comment({ subjectId: 'p', authorId: 'a', text: 'x'.repeat(10_001) }),
      /exceeds/,
    );
  });
});
