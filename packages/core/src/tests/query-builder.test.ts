// src/tests/query-builder.test.ts
// Tests for QueryBuilder (tasks 8.1–8.6).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { QueryBuilder, SqlDialect } from '../database/query-builder.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface User {
  id: number;
  name: string;
  email: string;
  age: number;
  status: string;
}

interface Order {
  id: number;
  user_id: number;
  total: number;
  created_at: string;
}

// ── 1. SELECT + WHERE + LIMIT ─────────────────────────────────────────────────

describe('QueryBuilder — select + where + limit (postgres)', () => {
  it('builds a basic SELECT with WHERE and LIMIT', () => {
    const { sql, params } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id', 'name', 'email')
      .from('users')
      .where('email', '=', 'alice@example.com')
      .limit(10)
      .build();

    assert.equal(sql, 'SELECT id, name, email FROM users WHERE email = $1 LIMIT 10');
    assert.deepEqual(params, ['alice@example.com']);
  });

  it('handles multiple WHERE conditions', () => {
    const { sql, params } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id', 'name')
      .from('users')
      .where('age', '>=', 18)
      .where('status', '=', 'active')
      .limit(5)
      .build();

    assert.equal(
      sql,
      'SELECT id, name FROM users WHERE age >= $1 AND status = $2 LIMIT 5',
    );
    assert.deepEqual(params, [18, 'active']);
  });

  it('defaults to SELECT * when no columns specified', () => {
    const { sql, params } = new QueryBuilder<User>(SqlDialect.postgres)
      .from('users')
      .build();

    assert.equal(sql, 'SELECT * FROM users');
    assert.deepEqual(params, []);
  });

  it('emits OFFSET clause', () => {
    const { sql } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id')
      .from('users')
      .limit(10)
      .offset(20)
      .build();

    assert.ok(sql.includes('LIMIT 10'));
    assert.ok(sql.includes('OFFSET 20'));
  });
});

// ── 2. JOIN + SUBQUERY ────────────────────────────────────────────────────────

describe('QueryBuilder — join + subquery', () => {
  it('builds INNER JOIN with ON condition', () => {
    const { sql, params } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id', 'name')
      .from('users')
      .join('orders', 'users.id = orders.user_id')
      .build();

    assert.equal(
      sql,
      'SELECT id, name FROM users INNER JOIN orders ON users.id = orders.user_id',
    );
    assert.deepEqual(params, []);
  });

  it('builds LEFT JOIN', () => {
    const { sql } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id', 'name')
      .from('users')
      .leftJoin('orders', 'users.id = orders.user_id')
      .build();

    assert.ok(sql.includes('LEFT JOIN orders ON users.id = orders.user_id'));
  });

  it('uses subquery as FROM source (postgres)', () => {
    const inner = new QueryBuilder<Order>(SqlDialect.postgres)
      .select('user_id', 'total')
      .from('orders')
      .where('total', '>', 100);

    const { sql, params } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id', 'name')
      .subquery(inner, 'rich_orders')
      .build();

    // The outer query's FROM should be a derived table
    assert.ok(sql.includes('FROM (SELECT'), `sql should include derived table; got: ${sql}`);
    assert.ok(sql.includes('AS rich_orders'), `sql should include alias; got: ${sql}`);
    // The inner param (100) must appear in the outer params
    assert.ok(params.includes(100), `params should include 100; got: ${JSON.stringify(params)}`);
  });

  it('uses subquery as a JOIN source', () => {
    const inner = new QueryBuilder<Order>()
      .select('user_id', 'total')
      .from('orders');

    const { sql } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id')
      .from('users')
      .subquery(inner, 'o')
      .build();

    assert.ok(sql.includes('INNER JOIN (SELECT'), `expected derived-table join; got: ${sql}`);
    assert.ok(sql.includes('AS o'), `expected alias o; got: ${sql}`);
  });

  it('threads subquery + outer params in correct order (join then where)', () => {
    // Inner subquery contributes one param (100); outer WHERE contributes one ('active').
    // Build order is FROM → JOIN → WHERE, so inner params must precede outer params.
    const inner = new QueryBuilder<Order>()
      .select('user_id', 'total')
      .from('orders')
      .where('total', '>', 100);

    const { sql, params } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id', 'name')
      .from('users')
      .subquery(inner, 'o')
      .where('status', '=', 'active')
      .build();

    // Inner subquery param ($1) is emitted before the outer WHERE param ($2).
    assert.equal(
      sql,
      'SELECT id, name FROM users '
        + 'INNER JOIN (SELECT user_id, total FROM orders WHERE total > $1) AS o '
        + 'WHERE status = $2',
    );
    // Params are threaded inner-first, then outer.
    assert.deepEqual(params, [100, 'active']);
  });

  it('threads subquery-as-FROM params before outer params (postgres renumbering)', () => {
    // Two inner params followed by one outer param, verifying $1,$2,$3 ordering.
    const inner = new QueryBuilder<Order>()
      .select('user_id', 'total')
      .from('orders')
      .where('total', '>', 100)
      .where('user_id', '=', 7);

    const { sql, params } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id')
      .subquery(inner, 'rich')
      .where('id', '>', 0)
      .build();

    assert.equal(
      sql,
      'SELECT id '
        + 'FROM (SELECT user_id, total FROM orders WHERE total > $1 AND user_id = $2) AS rich '
        + 'WHERE id > $3',
    );
    assert.deepEqual(params, [100, 7, 0]);
  });
});

// ── 3. IDEMPOTENT BUILD ───────────────────────────────────────────────────────

describe('QueryBuilder — idempotent build', () => {
  it('calling build() twice returns identical sql', () => {
    const qb = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id', 'name')
      .from('users')
      .where('age', '>=', 18)
      .where('status', '=', 'active')
      .orderBy('name', 'ASC')
      .limit(20)
      .offset(0);

    const first  = qb.build();
    const second = qb.build();

    assert.equal(first.sql, second.sql);
    assert.deepEqual(first.params, second.params);
    // The full {sql, params} result objects are deeply equal across builds.
    assert.deepEqual(first, second);
  });

  it('calling build() three times returns identical sql', () => {
    const qb = new QueryBuilder<Order>(SqlDialect.mysql)
      .select('id', 'total')
      .from('orders')
      .where('total', '>', 50)
      .limit(100);

    const results = [qb.build(), qb.build(), qb.build()];
    for (const r of results.slice(1)) {
      assert.equal(r.sql, results[0].sql);
      assert.deepEqual(r.params, results[0].params);
    }
  });

  it('build() does not mutate internal state', () => {
    const qb = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id')
      .from('users')
      .where('id', '=', 42);

    qb.build();
    qb.build();

    // Adding another where after two builds should include all three conditions
    qb.where('status', '=', 'active');
    const { sql, params } = qb.build();

    assert.ok(sql.includes('id = $1'));
    assert.ok(sql.includes('status = $2'));
    assert.deepEqual(params, [42, 'active']);
  });
});

// ── 4. PLACEHOLDER COUNT MATCHES PARAMS ──────────────────────────────────────

describe('QueryBuilder — placeholder count matches params array', () => {
  it('postgres: $n placeholder count equals params.length', () => {
    const { sql, params } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id', 'name')
      .from('users')
      .where('age', '>=', 18)
      .where('status', '=', 'active')
      .having('COUNT(*) > ?', 5)
      .build();

    // Count $1, $2, … style placeholders
    const matches = sql.match(/\$\d+/g) ?? [];
    assert.equal(
      matches.length,
      params.length,
      `placeholder count ${matches.length} ≠ params.length ${params.length}; sql="${sql}"`,
    );
  });

  it('mysql: ? placeholder count equals params.length', () => {
    const { sql, params } = new QueryBuilder<User>(SqlDialect.mysql)
      .select('id', 'name')
      .from('users')
      .where('age', '>=', 25)
      .where('status', '=', 'premium')
      .limit(50)
      .build();

    const matches = sql.match(/\?/g) ?? [];
    assert.equal(
      matches.length,
      params.length,
      `placeholder count ${matches.length} ≠ params.length ${params.length}; sql="${sql}"`,
    );
  });

  it('sqlite: ? placeholder count equals params.length', () => {
    const { sql, params } = new QueryBuilder<Order>(SqlDialect.sqlite)
      .select('id', 'total')
      .from('orders')
      .where('total', '>', 100)
      .where('user_id', '=', 7)
      .build();

    const matches = sql.match(/\?/g) ?? [];
    assert.equal(matches.length, params.length);
    assert.deepEqual(params, [100, 7]);
  });

  it('no params → no placeholders', () => {
    const { sql, params } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('id')
      .from('users')
      .build();

    assert.equal((sql.match(/\$\d+/g) ?? []).length, 0);
    assert.equal(params.length, 0);
  });
});

// ── 5. DIALECT-SPECIFIC PLACEHOLDER STYLE ────────────────────────────────────

describe('QueryBuilder — dialect-specific placeholder style', () => {
  const buildWithDialect = (d: SqlDialect) =>
    new QueryBuilder<User>(d)
      .select('id')
      .from('users')
      .where('email', '=', 'test@example.com')
      .where('age', '>', 21)
      .build();

  it('postgres uses $1, $2 placeholders', () => {
    const { sql, params } = buildWithDialect(SqlDialect.postgres);
    assert.ok(sql.includes('$1'), `expected $1 in sql: ${sql}`);
    assert.ok(sql.includes('$2'), `expected $2 in sql: ${sql}`);
    assert.ok(!sql.includes('?'), `should not include ? in postgres sql: ${sql}`);
    assert.equal(params.length, 2);
  });

  it('mysql uses ? placeholders', () => {
    const { sql, params } = buildWithDialect(SqlDialect.mysql);
    const qmarks = (sql.match(/\?/g) ?? []).length;
    assert.ok(!sql.match(/\$\d+/), `should not include $n in mysql sql: ${sql}`);
    assert.equal(qmarks, params.length);
  });

  it('sqlite uses ? placeholders', () => {
    const { sql, params } = buildWithDialect(SqlDialect.sqlite);
    const qmarks = (sql.match(/\?/g) ?? []).length;
    assert.ok(!sql.match(/\$\d+/), `should not include $n in sqlite sql: ${sql}`);
    assert.equal(qmarks, params.length);
  });

  it('defaults to postgres dialect', () => {
    // Default constructor → postgres
    const { sql } = new QueryBuilder<User>()
      .select('id')
      .from('users')
      .where('id', '=', 1)
      .build();

    assert.ok(sql.includes('$1'), `default dialect should be postgres; sql: ${sql}`);
  });
});

// ── 6. ADDITIONAL CLAUSES ─────────────────────────────────────────────────────

describe('QueryBuilder — additional clauses', () => {
  it('builds ORDER BY', () => {
    const { sql } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('name')
      .from('users')
      .orderBy('name', 'DESC')
      .build();

    assert.ok(sql.includes('ORDER BY name DESC'), `got: ${sql}`);
  });

  it('builds GROUP BY', () => {
    const { sql } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('status')
      .from('users')
      .groupBy('status')
      .build();

    assert.ok(sql.includes('GROUP BY status'), `got: ${sql}`);
  });

  it('builds HAVING', () => {
    const { sql, params } = new QueryBuilder<User>(SqlDialect.postgres)
      .select('status')
      .from('users')
      .groupBy('status')
      .having('COUNT(*) > ?', 5)
      .build();

    assert.ok(sql.includes('HAVING COUNT(*) > $1'), `got: ${sql}`);
    assert.deepEqual(params, [5]);
  });
});
