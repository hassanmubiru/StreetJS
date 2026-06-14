// Unit tests for entity metadata + registry validation. Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Entity, PrimaryKey, Column, HasMany, EntityRegistry, OrmError, isSafeIdentifier,
} from '../dist/index.js';
import { buildRegistry, User, Post } from './helpers.mjs';

describe('isSafeIdentifier', () => {
  it('accepts bare words, rejects anything else', () => {
    assert.equal(isSafeIdentifier('users'), true);
    assert.equal(isSafeIdentifier('author_id'), true);
    assert.equal(isSafeIdentifier('users; DROP TABLE x'), false);
    assert.equal(isSafeIdentifier('"users"'), false);
    assert.equal(isSafeIdentifier(''), false);
  });
});

describe('decorators reject unsafe identifiers', () => {
  it('throws on an injection-y table name', () => {
    assert.throws(() => Entity('users; DROP TABLE x'), OrmError);
  });
});

describe('EntityRegistry', () => {
  it('builds metadata for a valid graph', () => {
    const reg = buildRegistry();
    const m = reg.get(User);
    assert.equal(m.table, 'users');
    assert.equal(m.primaryKey.column, 'id');
    assert.equal(m.relations.length, 2);
  });

  it('rejects an entity with no @PrimaryKey', () => {
    class NoPk {}
    Column('x')(NoPk.prototype, 'x');
    Entity('no_pk')(NoPk);
    assert.throws(() => new EntityRegistry([NoPk]), /missing a @PrimaryKey/);
  });

  it('rejects an entity missing @Entity', () => {
    class Bare {}
    PrimaryKey()(Bare.prototype, 'id');
    assert.throws(() => new EntityRegistry([Bare]), /missing @Entity/);
  });

  it('rejects a relation whose target is not registered', () => {
    class A {}
    class B {}
    PrimaryKey()(A.prototype, 'id');
    HasMany(() => B, 'aId')(A.prototype, 'bs');
    Entity('a')(A);
    PrimaryKey()(B.prototype, 'id');
    Entity('b')(B);
    assert.throws(() => new EntityRegistry([A]), /not registered/); // B omitted
  });

  it('resolves a relation target meta', () => {
    const reg = buildRegistry();
    const postsRel = reg.get(User).relations.find((r) => r.property === 'posts');
    assert.equal(reg.metaOf(postsRel.target).table, 'posts');
  });
});
