// src/repositories/example.repository.ts
// Example repository backed by the Street framework's PostgreSQL pool.
//
// The pool is resolved LAZILY (inside each method), not in a field initializer,
// so the repository can be constructed even when the database is not yet
// configured. If it isn't, queries throw a clear error that the framework turns
// into an HTTP 503 — the server keeps running.

import { Injectable, container, PgPool } from 'streetjs';
import type { Item } from '../services/example.service.js';

type Row = Record<string, unknown>;

/** Map a database row to an Item */
function rowToItem(row: Row): Item {
  return {
    id: String(row['id'] ?? ''),
    name: String(row['name'] ?? ''),
    description: String(row['description'] ?? ''),
    createdAt: new Date(String(row['created_at'] ?? Date.now())),
    updatedAt: new Date(String(row['updated_at'] ?? Date.now())),
  };
}

@Injectable()
export class ExampleRepository {
  /** Lazily resolve the pool; throw a clear, recoverable error if unconfigured. */
  private get pool(): PgPool {
    try {
      return container.resolve(PgPool);
    } catch {
      const err = new Error('Database not configured — set credentials in .env (see .env.example).') as Error & { statusCode?: number };
      err.statusCode = 503;
      throw err;
    }
  }

  async findAll(page: number, limit: number): Promise<{ items: Item[]; total: number }> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        'SELECT * FROM items ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
      this.pool.query('SELECT COUNT(*) AS total FROM items'),
    ]);

    const items = (dataResult.rows as Row[]).map(rowToItem);
    const total = parseInt(String(countResult.rows[0]?.['total'] ?? '0'), 10);

    return { items, total };
  }

  async findById(id: string): Promise<Item | null> {
    const result = await this.pool.query(
      'SELECT * FROM items WHERE id = $1',
      [id]
    );
    const row = result.rows[0] as Row | undefined;
    return row ? rowToItem(row) : null;
  }

  async create(item: Item): Promise<void> {
    await this.pool.query(
      `INSERT INTO items (id, name, description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [item.id, item.name, item.description, item.createdAt.toISOString(), item.updatedAt.toISOString()]
    );
  }

  async update(item: Item): Promise<void> {
    await this.pool.query(
      `UPDATE items
       SET name = $1, description = $2, updated_at = $3
       WHERE id = $4`,
      [item.name, item.description, item.updatedAt.toISOString(), item.id]
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM items WHERE id = $1', [id]);
  }
}
