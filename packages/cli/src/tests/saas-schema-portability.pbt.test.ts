// saas-schema-portability.pbt.test.ts
// Property-based test for the SaaS starter's schema portability guarantee.
//
//   Property 10 (Schema portability): the `001` -> `002` -> `003` migration set
//   applies cleanly on both SQLite (dev) and Postgres (prod) given the documented
//   type adjustments. The migrations are authored as PostgreSQL DDL; the core
//   runner applies these documented SQLite adjustments (SAAS.md / design):
//       BIGSERIAL PRIMARY KEY -> INTEGER PRIMARY KEY AUTOINCREMENT
//       TIMESTAMPTZ           -> TEXT / DATETIME
//       JSONB                 -> TEXT
//       now()                 -> CURRENT_TIMESTAMP
//   **Validates: Requirements 10.1, 10.2, 10.3**
//
// The three migrations ship as TEMPLATE STRINGS in `TEMPLATES.saas.extraFiles` at
// `migrations/001_saas.sql`, `migrations/002_api_keys.sql`, and
// `migrations/003_settings.sql` (see packages/cli/src/commands/create.ts). They
// are plain SQL with no imports, so we read the registered template strings
// directly — the same extraction approach used by the sibling settings PBT, minus
// the transpile/import step (which only applies to `.ts` overlay modules).
//
// WHAT IS ACTUALLY VERIFIED HERE
// ------------------------------
// Postgres is NOT available in this environment and the core SQLite driver's WASM
// binary is not reliably loadable from the CLI package's test context, so this
// test does NOT connect to a live Postgres and does NOT depend on a real SQLite
// engine. Instead it verifies portability at the TRANSFORM level — it applies the
// documented SQLite type-adjustment rules to each migration's DDL and asserts a
// set of portability invariants over the full migration set (across all three
// migrations and the 001 -> 002 -> 003 ordering):
//
//   1. No residual Postgres-only tokens remain after the SQLite adjustment
//      (no BIGSERIAL / TIMESTAMPTZ / JSONB / now()).
//   2. Structure is preserved: every CREATE TABLE / CREATE INDEX statement is kept
//      under both the Postgres form and the SQLite-adjusted form (same count and
//      same table/index names).
//   3. The adjustment transform is idempotent.
//   4. Every statement is well-formed (starts with CREATE, balanced parentheses).
//
// As a BONUS — gated purely on availability and NEVER a hard failure of the
// environment — if a real in-memory SQLite engine (`node:sqlite`) is importable,
// the adjusted DDL for the full set is executed against it and asserted to apply
// without error.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { TEMPLATES } from '../commands/create.js';

// ---------------------------------------------------------------------------
// Migration extraction (read the registered template strings)
// ---------------------------------------------------------------------------

/** Ordered migration template paths shipped by the saas overlay. */
const MIGRATION_PATHS = [
  'migrations/001_saas.sql',
  'migrations/002_api_keys.sql',
  'migrations/003_settings.sql',
] as const;

type MigrationPath = (typeof MIGRATION_PATHS)[number];

/** Expected CREATE TABLE / CREATE INDEX names per migration (for structure checks). */
const EXPECTED: Record<MigrationPath, { tables: string[]; indexes: string[] }> = {
  'migrations/001_saas.sql': {
    tables: [
      'users',
      'organizations',
      'memberships',
      'invitations',
      'subscriptions',
      'audit_logs',
      'notifications',
    ],
    indexes: ['idx_memberships_user', 'idx_audit_org_created', 'idx_notifications_user'],
  },
  'migrations/002_api_keys.sql': {
    tables: ['api_keys'],
    indexes: ['idx_api_keys_org', 'idx_api_keys_prefix'],
  },
  'migrations/003_settings.sql': {
    tables: ['org_settings', 'user_settings'],
    indexes: ['idx_org_settings', 'idx_user_settings'],
  },
};

/** Read a migration's raw PostgreSQL DDL from TEMPLATES.saas.extraFiles. */
function readMigration(path: MigrationPath): string {
  const file = TEMPLATES.saas.extraFiles?.find((f) => f.path === path);
  assert.ok(file, `saas overlay must register ${path}`);
  return file!.content;
}

// ---------------------------------------------------------------------------
// Documented SQLite type-adjustment transform (mirrors SAAS.md / design)
// ---------------------------------------------------------------------------

/** Postgres-only tokens that MUST NOT survive the SQLite adjustment. */
const POSTGRES_ONLY_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'BIGSERIAL', re: /\bBIGSERIAL\b/i },
  { name: 'TIMESTAMPTZ', re: /\bTIMESTAMPTZ\b/i },
  { name: 'JSONB', re: /\bJSONB\b/i },
  { name: 'now()', re: /\bnow\s*\(\s*\)/i },
];

/**
 * Apply the documented PostgreSQL -> SQLite type adjustments. Whitespace-tolerant
 * so that token variants (e.g. `now( )`, `BIGSERIAL   PRIMARY KEY`) are handled.
 * Order matters: the compound `BIGSERIAL PRIMARY KEY` rule runs before the
 * standalone `BIGSERIAL` fallback.
 */
function toSqlite(ddl: string): string {
  return ddl
    .replace(/\bBIGSERIAL\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/\bBIGSERIAL\b/gi, 'INTEGER')
    .replace(/\bTIMESTAMPTZ\b/gi, 'TEXT')
    .replace(/\bJSONB\b/gi, 'TEXT')
    .replace(/\bnow\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP');
}

// ---------------------------------------------------------------------------
// Lightweight SQL structure helpers
// ---------------------------------------------------------------------------

/** Remove `-- ...` line comments so structural analysis sees DDL only. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/** Split DDL into non-empty trimmed statements (comments removed). */
function splitStatements(sql: string): string[] {
  return stripComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tableNames(sql: string): string[] {
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
  return [...stripComments(sql).matchAll(re)].map((m) => m[1].toLowerCase());
}

function indexNames(sql: string): string[] {
  const re = /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
  return [...stripComments(sql).matchAll(re)].map((m) => m[1].toLowerCase());
}

/** True if parentheses are balanced across the (comment-free) statement. */
function parensBalanced(stmt: string): boolean {
  let depth = 0;
  for (const ch of stripComments(stmt)) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

// ---------------------------------------------------------------------------
// fast-check generators: which migrations, in which order, joined how
// ---------------------------------------------------------------------------

/** A non-empty subset of migration paths, in an arbitrary order. */
const migrationSubsetArb: fc.Arbitrary<MigrationPath[]> = fc
  .subarray([...MIGRATION_PATHS], { minLength: 1 })
  .chain((subset) => fc.shuffledSubarray(subset, { minLength: subset.length }));

/** Random horizontal/vertical whitespace used to glue statements/migrations. */
const whitespaceArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r\n'), { minLength: 1, maxLength: 6 })
  .map((parts) => parts.join(''));

/** Assemble selected migrations into one script joined by random whitespace. */
function assemble(paths: MigrationPath[], sep: string): string {
  return paths.map(readMigration).join(`;${sep}`.replace(/^;/, sep)) /* keep own ; */ === ''
    ? ''
    : paths.map(readMigration).join(sep);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 10: Schema portability (001 -> 002 -> 003) — Validates: Requirements 10.1, 10.2, 10.3', () => {
  before(() => {
    // Sanity: all three migrations are registered and non-empty.
    for (const p of MIGRATION_PATHS) {
      const ddl = readMigration(p);
      assert.ok(ddl.trim().length > 0, `${p} must have content`);
    }
  });

  it('full set in order parses to the expected tables and indexes (Postgres form)', () => {
    const all = MIGRATION_PATHS.map(readMigration).join('\n');
    const expectedTables = MIGRATION_PATHS.flatMap((p) => EXPECTED[p].tables).sort();
    const expectedIndexes = MIGRATION_PATHS.flatMap((p) => EXPECTED[p].indexes).sort();

    assert.deepEqual(tableNames(all).sort(), expectedTables, 'all CREATE TABLE statements present');
    assert.deepEqual(indexNames(all).sort(), expectedIndexes, 'all CREATE INDEX statements present');
    assert.equal(tableNames(all).length, 10, 'expected 10 tables across the set');
    assert.equal(indexNames(all).length, 7, 'expected 7 indexes across the set');
  });

  it('after SQLite adjustment, NO residual Postgres-only tokens remain (any subset/order/whitespace)', () => {
    fc.assert(
      fc.property(migrationSubsetArb, whitespaceArb, (paths, sep) => {
        const pg = paths.map(readMigration).join(sep);
        const sqlite = toSqlite(pg);
        for (const { name, re } of POSTGRES_ONLY_PATTERNS) {
          assert.ok(
            !re.test(stripComments(sqlite)),
            `SQLite-adjusted DDL must not contain Postgres-only token ${name}`,
          );
        }
        // The adjustment must have introduced the SQLite autoincrement form for PKs.
        assert.ok(/INTEGER PRIMARY KEY AUTOINCREMENT/.test(sqlite), 'PK form must be adjusted for SQLite');
      }),
      { numRuns: 300 },
    );
  });

  it('CREATE TABLE / CREATE INDEX statements are preserved by the adjustment (count + names)', () => {
    fc.assert(
      fc.property(migrationSubsetArb, whitespaceArb, (paths, sep) => {
        const pg = paths.map(readMigration).join(sep);
        const sqlite = toSqlite(pg);

        // Counts preserved.
        assert.equal(
          splitStatements(sqlite).length,
          splitStatements(pg).length,
          'statement count must be preserved under adjustment',
        );
        // Table/index names preserved exactly (set + multiplicity).
        assert.deepEqual(tableNames(sqlite).sort(), tableNames(pg).sort(), 'table names preserved');
        assert.deepEqual(indexNames(sqlite).sort(), indexNames(pg).sort(), 'index names preserved');

        // And they match the documented expectation for the chosen subset.
        const expectedTables = paths.flatMap((p) => EXPECTED[p].tables).sort();
        const expectedIndexes = paths.flatMap((p) => EXPECTED[p].indexes).sort();
        assert.deepEqual(tableNames(pg).sort(), expectedTables, 'subset tables match design');
        assert.deepEqual(indexNames(pg).sort(), expectedIndexes, 'subset indexes match design');
      }),
      { numRuns: 300 },
    );
  });

  it('the SQLite adjustment transform is idempotent', () => {
    fc.assert(
      fc.property(migrationSubsetArb, whitespaceArb, (paths, sep) => {
        const pg = paths.map(readMigration).join(sep);
        const once = toSqlite(pg);
        const twice = toSqlite(once);
        assert.equal(twice, once, 'applying the adjustment twice equals applying it once');
      }),
      { numRuns: 300 },
    );
  });

  it('every statement is well-formed (CREATE-prefixed, balanced parentheses) in both forms', () => {
    fc.assert(
      fc.property(migrationSubsetArb, whitespaceArb, (paths, sep) => {
        const pg = paths.map(readMigration).join(sep);
        for (const form of [pg, toSqlite(pg)]) {
          for (const stmt of splitStatements(form)) {
            assert.match(stmt, /^CREATE\s+(TABLE|INDEX)\b/i, 'each statement is a CREATE TABLE/INDEX');
            assert.ok(parensBalanced(stmt), `parentheses must be balanced in: ${stmt.slice(0, 40)}...`);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('transform is robust to token whitespace variants (now( ), BIGSERIAL  PRIMARY  KEY)', () => {
    const tokenWsArb = fc.array(fc.constantFrom(' ', '\t', '  ', '\n'), { minLength: 1, maxLength: 3 }).map((p) => p.join(''));
    fc.assert(
      fc.property(tokenWsArb, tokenWsArb, (ws1, ws2) => {
        const synthetic =
          `CREATE TABLE IF NOT EXISTS t (\n` +
          `  id BIGSERIAL${ws1}PRIMARY${ws2}KEY,\n` +
          `  created_at TIMESTAMPTZ NOT NULL DEFAULT now(${ws1}),\n` +
          `  meta JSONB\n);`;
        const sqlite = toSqlite(synthetic);
        for (const { name, re } of POSTGRES_ONLY_PATTERNS) {
          assert.ok(!re.test(sqlite), `whitespace variant of ${name} must still be adjusted`);
        }
        assert.ok(/INTEGER PRIMARY KEY AUTOINCREMENT/.test(sqlite), 'PK adjusted despite extra whitespace');
        assert.ok(/CURRENT_TIMESTAMP/.test(sqlite), 'now() adjusted despite extra whitespace');
      }),
      { numRuns: 200 },
    );
  });

  // -------------------------------------------------------------------------
  // BONUS (availability-gated): apply the adjusted full set to a real in-memory
  // SQLite engine if one is importable. This is NEVER a hard failure — when no
  // engine is available (e.g. Node < 22 without node:sqlite) the check is skipped.
  // -------------------------------------------------------------------------
  it('BONUS: adjusted full set executes on a real in-memory SQLite engine if available', async (t) => {
    let DatabaseSync: (new (path: string) => { exec(sql: string): void; close(): void }) | null = null;
    try {
      const mod = (await import('node:sqlite')) as unknown as {
        DatabaseSync: new (path: string) => { exec(sql: string): void; close(): void };
      };
      DatabaseSync = mod.DatabaseSync ?? null;
    } catch {
      DatabaseSync = null;
    }

    if (!DatabaseSync) {
      t.skip('no in-memory SQLite engine available in this environment (bonus check skipped)');
      return;
    }

    const fullSet = MIGRATION_PATHS.map(readMigration).join('\n');
    const sqlite = toSqlite(fullSet);
    const db = new DatabaseSync(':memory:');
    try {
      // Should apply cleanly with no error (001 -> 002 -> 003 ordering preserved).
      db.exec(sqlite);
    } finally {
      db.close();
    }
  });
});
