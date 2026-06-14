// Unit tests for the parameterized SQL planner. Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelect, buildRelationLoad } from '../dist/index.js';
import { User, Post, buildRegistry } from './helpers.mjs';

const reg = buildRegistry();
const userMeta = reg.get(User);
const postMeta = reg.get(Post);

describe('buildSelect', () => {
  it('selects all columns from the table', () => {
    const { sql, params } = buildSelect(userMeta);
    assert.equal(sql, 'SELECT "id", "email" FROM "users"');
    assert.deepEqual(params, []);
  });

  it('parameterizes a where clause and a limit', () => {
    const { sql, params } = buildSelect(userMeta, { where: { id: 7 }, limit: 5 });
    assert.equal(sql, 'SELECT "id", "email" FROM "users" WHERE "id" = $1 LIMIT $2');
    assert.deepEqual(params, [7, 5]);
  });

  it('accepts filtering by property or column name', () => {
    const { sql, params } = buildSelect(userMeta, { where: { email: 'a@b.co' } });
    assert.match(sql, /WHERE "email" = \$1$/);
    assert.deepEqual(params, ['a@b.co']);
  });

  it('rejects an unknown filter column', () => {
    assert.throws(() => buildSelect(userMeta, { where: { bogus: 1 } }), /unknown column/);
  });

  it('rejects a negative limit', () => {
    assert.throws(() => buildSelect(userMeta, { limit: -1 }), /invalid limit/);
  });
});

describe('buildRelationLoad', () => {
  const rel = (meta, name) => meta.relations.find((r) => r.property === name);

  it('hasMany → IN over the target foreign key, parameterized', () => {
    const { sql, params } = buildRelationLoad(rel(userMeta, 'posts'), userMeta, postMeta, [1, 2, 3]);
    assert.match(sql, /FROM "posts" WHERE "authorId" IN \(\$1, \$2, \$3\)/);
    assert.deepEqual(params, [1, 2, 3]);
  });

  it('belongsTo → IN over the target primary key', () => {
    const { sql, params } = buildRelationLoad(rel(postMeta, 'author'), postMeta, userMeta, [10, 11]);
    assert.match(sql, /FROM "users" WHERE "id" IN \(\$1, \$2\)/);
    assert.deepEqual(params, [10, 11]);
  });

  it('manyToMany → join the through table, returning the owner key', () => {
    const { sql, params } = buildRelationLoad(rel(postMeta, 'tags'), postMeta, reg.get(rel(postMeta, 'tags').target()), [5]);
    assert.match(sql, /FROM "post_tags" j/);
    assert.match(sql, /JOIN "tags" t ON t\."id" = j\."tagId"/);
    assert.match(sql, /j\."postId" AS __owner_key/);
    assert.match(sql, /WHERE j\."postId" IN \(\$1\)/);
    assert.deepEqual(params, [5]);
  });

  it('appends a parameterized relation filter', () => {
    const { sql, params } = buildRelationLoad(rel(userMeta, 'posts'), userMeta, postMeta, [1], { published: true });
    assert.match(sql, /WHERE "authorId" IN \(\$1\) AND "published" = \$2/);
    assert.deepEqual(params, [1, true]);
  });

  it('returns an empty query for zero keys', () => {
    const { sql } = buildRelationLoad(rel(userMeta, 'posts'), userMeta, postMeta, []);
    assert.equal(sql, '');
  });
});
