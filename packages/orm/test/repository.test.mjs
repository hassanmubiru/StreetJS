// Repository tests with a scripted fake pool — verifies eager loading, N+1
// safety (one query per relation regardless of parent count), and lazy loading.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Orm } from '../dist/index.js';
import { User, Post, Profile, Tag } from './helpers.mjs';

// A pool that returns queued responses in order and records every query.
function scriptedPool(responses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query(sql, params) {
      calls.push({ sql, params });
      const rows = responses[i++] ?? [];
      return Promise.resolve({ rows });
    },
  };
}

function makeOrm(pool) {
  return new Orm({ pool, entities: [User, Post, Profile, Tag] });
}

describe('Repository eager loading', () => {
  it('hasMany + hasOne: one batched query per relation (N+1-safe)', async () => {
    const pool = scriptedPool([
      [{ id: 1, email: 'a@x.co' }, { id: 2, email: 'b@x.co' }],          // base users
      [{ id: 10, authorId: 1, published: true }, { id: 11, authorId: 2, published: true }], // posts (hasMany)
      [{ id: 100, userId: 1, bio: 'hi' }],                                // profiles (hasOne)
    ]);
    const users = makeOrm(pool).getRepository(User);
    const rows = await users.find({ with: ['posts', 'profile'] });

    // 1 base + 1 per relation = 3 queries total, regardless of 2 parents.
    assert.equal(pool.calls.length, 3);
    assert.equal(rows[0].posts.length, 1);
    assert.equal(rows[0].posts[0].id, 10);
    assert.equal(rows[0].profile.bio, 'hi');
    assert.equal(rows[1].posts[0].id, 11);
    assert.equal(rows[1].profile, null);            // no profile for user 2
  });

  it('belongsTo: resolves the parent by FK', async () => {
    const pool = scriptedPool([
      [{ id: 10, authorId: 1, published: true }],   // base posts
      [{ id: 1, email: 'a@x.co' }],                 // authors (belongsTo)
    ]);
    const posts = makeOrm(pool).getRepository(Post);
    const rows = await posts.find({ with: ['author'] });
    assert.equal(pool.calls.length, 2);
    assert.equal(rows[0].author.email, 'a@x.co');
  });

  it('manyToMany: groups target rows by the owner key', async () => {
    const pool = scriptedPool([
      [{ id: 10, authorId: 1, published: true }],                         // base posts
      [{ __owner_key: 10, id: 5, name: 'ts' }, { __owner_key: 10, id: 6, name: 'db' }], // tags via join
    ]);
    const posts = makeOrm(pool).getRepository(Post);
    const rows = await posts.find({ with: ['tags'] });
    assert.equal(pool.calls.length, 2);
    assert.deepEqual(rows[0].tags.map((t) => t.name), ['ts', 'db']);
  });

  it('passes a relation filter into the batched query', async () => {
    const pool = scriptedPool([[{ id: 1, email: 'a@x.co' }], []]);
    const users = makeOrm(pool).getRepository(User);
    await users.find({ with: { posts: { where: { published: true } } } });
    assert.match(pool.calls[1].sql, /AND "published" = \$2/);
    assert.deepEqual(pool.calls[1].params, [1, true]);
  });
});

describe('Repository lazy loading', () => {
  it('loadRelation fetches a single relation on demand', async () => {
    const pool = scriptedPool([
      [{ id: 1, email: 'a@x.co' }],                 // base user
      [{ id: 10, authorId: 1, published: true }],   // lazy posts
    ]);
    const users = makeOrm(pool).getRepository(User);
    const u = await users.findOne({ where: { id: 1 } });
    assert.equal(pool.calls.length, 1);             // no relation loaded yet
    const posts = await users.loadRelation(u, 'posts');
    assert.equal(pool.calls.length, 2);
    assert.equal(posts[0].id, 10);
    assert.equal(u.posts[0].id, 10);                // also attached to the entity
  });
});

describe('Repository findOne', () => {
  it('returns null when nothing matches', async () => {
    const pool = scriptedPool([[]]);
    const users = makeOrm(pool).getRepository(User);
    assert.equal(await users.findOne({ where: { id: 999 } }), null);
  });
});
