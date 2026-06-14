// Unit tests for the model-driven migration planner. Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Entity, PrimaryKey, Column, EntityRegistry, planMigration, OrmError } from '../dist/index.js';

class Widget {}
PrimaryKey()(Widget.prototype, 'id');                         // integer PK
Column('name')(Widget.prototype, 'name');                     // text
Column('price', { type: 'numeric(10,2)' })(Widget.prototype, 'price'); // typed (will reject — has comma)
Entity('widgets')(Widget);

describe('decorator type validation', () => {
  it('rejects an unsafe SQL type', () => {
    // numeric(10,2) contains a comma → rejected by isSafeSqlType
    class Bad {}
    PrimaryKey()(Bad.prototype, 'id');
    assert.throws(() => Column('x', { type: 'int; DROP TABLE y' })(Bad.prototype, 'x'), OrmError);
  });
});

describe('planMigration — table does not exist', () => {
  it('emits CREATE TABLE with columns, types, and PK; down drops it', () => {
    class T {}
    PrimaryKey()(T.prototype, 'id');
    Column('email')(T.prototype, 'email');
    Column('age', { type: 'integer' })(T.prototype, 'age');
    Entity('t_create')(T);
    const meta = new EntityRegistry([T]).get(T);
    const plan = planMigration(meta, { tableExists: false, columns: [] });
    assert.equal(plan.up.length, 1);
    assert.match(plan.up[0], /^CREATE TABLE "t_create" \("id" integer PRIMARY KEY, "email" text, "age" integer\)$/);
    assert.deepEqual(plan.down, ['DROP TABLE "t_create"']);
  });
});

describe('planMigration — table exists (additive)', () => {
  function meta(table) {
    class M {}
    PrimaryKey()(M.prototype, 'id');
    Column('email')(M.prototype, 'email');
    Column('verified', { type: 'boolean' })(M.prototype, 'verified');
    Entity(table)(M);
    return new EntityRegistry([M]).get(M);
  }

  it('adds only columns missing from the DB', () => {
    const plan = planMigration(meta('t_add'), { tableExists: true, columns: ['id', 'email'] });
    assert.deepEqual(plan.up, ['ALTER TABLE "t_add" ADD COLUMN "verified" boolean']);
    assert.deepEqual(plan.down, ['ALTER TABLE "t_add" DROP COLUMN "verified"']);
  });

  it('is a no-op when the schema already matches', () => {
    const plan = planMigration(meta('t_same'), { tableExists: true, columns: ['id', 'email', 'verified'] });
    assert.deepEqual(plan.up, []);
    assert.deepEqual(plan.down, []);
  });

  it('does NOT drop extra DB columns by default (additive)', () => {
    const plan = planMigration(meta('t_extra'), { tableExists: true, columns: ['id', 'email', 'verified', 'legacy'] });
    assert.deepEqual(plan.up, []);
  });

  it('drops extra DB columns only with dropColumns:true', () => {
    const plan = planMigration(meta('t_drop'), { tableExists: true, columns: ['id', 'email', 'verified', 'legacy'] }, { dropColumns: true });
    assert.deepEqual(plan.up, ['ALTER TABLE "t_drop" DROP COLUMN "legacy"']);
    assert.match(plan.down[0], /^-- manual: re-add dropped column "legacy"/);
  });
});
