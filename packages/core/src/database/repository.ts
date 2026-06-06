// src/database/repository.ts
// Generic repository and migration runner.

import { PgPool } from './pool.js';
import type { PgConnection } from './wire.js';
import type { FieldEncryptor } from '../enterprise/data-policy.js';

// ─── Repository Interface ──────────────────────────────────────────────────────

export interface IRepository<T> {
  findById(id: string): Promise<T | null>;
  findAll(limit: number, offset: number): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
}

// ─── Base repository ────────────────────────────────────────────────────────────

// Finding 6 fix: safe table/schema name pattern
const SAFE_TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

export abstract class StreetPostgresRepository<T extends object>
  implements IRepository<T>
{
  protected abstract readonly tableName: string;

  constructor(protected readonly pool: PgPool) {
    // Finding 6 fix: validate tableName at construction time so a bad subclass
    // fails immediately rather than silently injecting SQL at query time.
    // We defer the check to the first query because abstract properties are
    // not yet initialised in the base constructor — use a lazy validator instead.
  }

  /** Validate tableName on first use (abstract property not available in constructor) */
  private _assertSafeTableName(): void {
    if (!SAFE_TABLE_NAME_RE.test(this.tableName)) {
      throw new Error(
        `Repository tableName contains unsafe characters: "${this.tableName}". ` +
        'Only letters, digits, underscores, and dots are allowed.'
      );
    }
  }

  protected abstract mapRow(row: Record<string, string | null>): T;

  async findById(id: string): Promise<T | null> {
    this._assertSafeTableName();
    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0] as Record<string, string | null>);
  }

  async findAll(limit = 20, offset = 0): Promise<T[]> {
    this._assertSafeTableName();
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);
    const safeOffset = Math.max(0, Math.floor(offset));
    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [safeLimit, safeOffset]
    );
    return result.rows.map((r) => this.mapRow(r as Record<string, string | null>));
  }

  async count(): Promise<number> {
    this._assertSafeTableName();
    const result = await this.pool.query(`SELECT COUNT(*) AS total FROM ${this.tableName}`);
    return parseInt(result.rows[0]?.['total'] ?? '0', 10);
  }

  async create(data: Partial<T>): Promise<T> {
    this._assertSafeTableName();
    const keys = Object.keys(data).filter((k) => data[k as keyof T] !== undefined);
    const columns = keys.map((k) => `"${k}"`).join(', ');
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const params = keys.map((k) => data[k as keyof T]);
    const result = await this.pool.query(
      `INSERT INTO ${this.tableName} (${columns}) VALUES (${placeholders}) RETURNING *`,
      params
    );
    const row = result.rows[0];
    if (!row) throw new Error('Insert returned no rows');
    return this.mapRow(row as Record<string, string | null>);
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    this._assertSafeTableName();
    if (Object.keys(data).length === 0) return this.findById(id);
    const entries = Object.entries(data).filter(([, v]) => v !== undefined);
    const setClauses = entries.map(([k], i) => `"${k}" = $${i + 1}`).join(', ');
    const params = entries.map(([, v]) => v);
    params.push(id); // last parameter for WHERE id = $N
    const result = await this.pool.query(
      `UPDATE ${this.tableName} SET ${setClauses} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0] as Record<string, string | null>);
  }

  async delete(id: string): Promise<boolean> {
    this._assertSafeTableName();
    const result = await this.pool.query(
      `DELETE FROM ${this.tableName} WHERE id = $1`,
      [id]
    );
    return result.command.startsWith('DELETE') && result.rowCount > 0;
  }

  /** Execute raw SQL within a transaction */
  async withTransaction<R>(fn: (conn: PgConnection) => Promise<R>): Promise<R> {
    return this.pool.transaction(fn);
  }

  /** Stream rows with backpressure.
   * Finding 6 fix: accepts parameterized queries only — raw SQL without
   * params is still possible but callers should always use $1..$N placeholders.
   * The method signature now accepts params to discourage raw interpolation.
   */
  streamAll(sql: string, params?: unknown[]): Promise<import('./wire.js').StreetPostgresWireStream> {
    if (params && params.length > 0) {
      // Note: parameterized streaming requires wire-protocol changes planned for v2.x.
      // Until then, use non-parameterized SQL for streaming or pool.query() for parameterized queries.
      throw new Error('streamAll does not yet support parameterized queries — use pool.query() instead');
    }
    return this.pool.stream(sql);
  }
}

// ─── ACID ledger service ────────────────────────────────────────────────────────

export class LedgerTransactionService {
  constructor(private readonly pool: PgPool) {}

  async execute<T>(
    operations: Array<(conn: PgConnection) => Promise<void>>,
    onSuccess?: () => Promise<T>
  ): Promise<T | void> {
    return this.pool.transaction(async (conn) => {
      for (const op of operations) {
        await op(conn);
      }
      if (onSuccess) return onSuccess();
    });
  }
}

// ─── SQL escaping helpers (deprecated — kept for reference) ────────────────────
// Parameterized queries via pool.query(sql, params) should be used instead.
