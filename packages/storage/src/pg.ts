// packages/storage/src/pg.ts
// Postgres-backed StorageProvider. Object bytes are stored base64-encoded in a
// TEXT column (reliable round-trip across the Street wire driver); metadata is
// JSONB. Apply STORAGE_MIGRATION_SQL once at bootstrap.

import type { StorageProvider, PutOptions, StoredObject, ObjectInfo } from './internal.js';
import { validateKey } from './internal.js';

/** Schema for the Postgres storage provider. */
export const STORAGE_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_storage_objects (
  bucket       TEXT NOT NULL,
  key          TEXT NOT NULL,
  data_b64     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket, key)
);
CREATE INDEX IF NOT EXISTS street_storage_objects_key_idx
  ON street_storage_objects (bucket, key);
`.trim();

export interface StoragePool {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number; command: string }>;
}

export interface PgStorageProviderOptions {
  /** Logical bucket name (rows are scoped to it). Default 'default'. */
  bucket?: string;
}

/** Postgres-backed {@link StorageProvider} over {@link STORAGE_MIGRATION_SQL}. */
export class PgStorageProvider implements StorageProvider {
  readonly name = 'postgres';
  private readonly bucket: string;

  constructor(private readonly pool: StoragePool, options: PgStorageProviderOptions = {}) {
    this.bucket = options.bucket ?? 'default';
  }

  async put(key: string, data: Buffer, options: PutOptions = {}): Promise<ObjectInfo> {
    validateKey(key);
    const contentType = options.contentType ?? 'application/octet-stream';
    await this.pool.query(
      `INSERT INTO street_storage_objects (bucket, key, data_b64, content_type, size, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (bucket, key)
       DO UPDATE SET data_b64 = EXCLUDED.data_b64, content_type = EXCLUDED.content_type,
                     size = EXCLUDED.size, metadata = EXCLUDED.metadata`,
      [this.bucket, key, data.toString('base64'), contentType, data.byteLength, JSON.stringify(options.metadata ?? {})],
    );
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string): Promise<StoredObject | undefined> {
    validateKey(key);
    const res = await this.pool.query(
      `SELECT key, data_b64, content_type, size, metadata
       FROM street_storage_objects WHERE bucket = $1 AND key = $2`,
      [this.bucket, key],
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return {
      key: String(row['key']),
      data: Buffer.from(String(row['data_b64']), 'base64'),
      contentType: String(row['content_type']),
      size: Number(row['size']),
      metadata: parseMetadata(row['metadata']),
    };
  }

  async delete(key: string): Promise<boolean> {
    validateKey(key);
    const res = await this.pool.query(
      `DELETE FROM street_storage_objects WHERE bucket = $1 AND key = $2`,
      [this.bucket, key],
    );
    return res.rowCount > 0;
  }

  async exists(key: string): Promise<boolean> {
    validateKey(key);
    const res = await this.pool.query(
      `SELECT 1 FROM street_storage_objects WHERE bucket = $1 AND key = $2`,
      [this.bucket, key],
    );
    return res.rowCount > 0;
  }

  async list(prefix = ''): Promise<ObjectInfo[]> {
    const res = await this.pool.query(
      `SELECT key, content_type, size FROM street_storage_objects
       WHERE bucket = $1 AND key LIKE $2 || '%' ORDER BY key ASC`,
      [this.bucket, prefix],
    );
    return res.rows.map((r) => ({ key: String(r['key']), size: Number(r['size']), contentType: String(r['content_type']) }));
  }
}

function parseMetadata(raw: unknown): Record<string, string> {
  if (typeof raw === 'string' && raw.length > 0) return JSON.parse(raw) as Record<string, string>;
  if (raw && typeof raw === 'object') return raw as Record<string, string>;
  return {};
}
