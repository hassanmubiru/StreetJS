// src/enterprise/backup.ts
// Backup framework with pluggable storage adapters and SHA-256 integrity verification.

import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';

export const BACKUPS_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS street_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  size_bytes BIGINT,
  duration_ms INT,
  checksum TEXT,
  storage_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);`;

// ---------------------------------------------------------------------------
// StorageAdapter interface
// ---------------------------------------------------------------------------

export interface StorageAdapter {
  write(key: string, stream: NodeJS.ReadableStream): Promise<void>;
  read(key: string): Promise<NodeJS.ReadableStream>;
  list(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// LocalStorageAdapter
// ---------------------------------------------------------------------------

export class LocalStorageAdapter implements StorageAdapter {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  async write(key: string, stream: NodeJS.ReadableStream): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
    const filePath = join(this.basePath, _sanitizeKey(key));
    const writeStream = createWriteStream(filePath);
    await pipeline(stream as Readable, writeStream);
  }

  async read(key: string): Promise<NodeJS.ReadableStream> {
    const filePath = join(this.basePath, _sanitizeKey(key));
    await fs.access(filePath); // throws ENOENT if missing
    return createReadStream(filePath);
  }

  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.basePath);
      return entries.filter((e) => !e.startsWith('.'));
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// BackupRecord
// ---------------------------------------------------------------------------

export interface BackupRecord {
  id: string;
  sizeBytes: number;
  durationMs: number;
  checksum: string;
  storageKey: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// GenericPool
// ---------------------------------------------------------------------------

export interface GenericPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// ---------------------------------------------------------------------------
// BackupService
// ---------------------------------------------------------------------------

export class BackupService {
  private readonly pool: GenericPool;
  private readonly storage: StorageAdapter;

  constructor(pool: GenericPool, storage: StorageAdapter) {
    this.pool = pool;
    this.storage = storage;
  }

  /**
   * Creates a backup of all data accessible through the pool.
   * Returns the backup ID.
   */
  async backup(): Promise<string> {
    const startMs = Date.now();
    const backupId = _uuid();
    const storageKey = `backup-${backupId}.sql`;

    // Collect a SQL dump by streaming rows from key tables
    const tables = await this._listTables();
    const hash = createHash('sha256');
    let totalBytes = 0;

    const dataStream = new Readable({ read() {} });

    const writePromise = this.storage.write(storageKey, dataStream);

    // Write a header comment
    const header = `-- Street Framework Backup\n-- ID: ${backupId}\n-- Created: ${new Date().toISOString()}\n\n`;
    dataStream.push(Buffer.from(header, 'utf8'));
    hash.update(header);
    totalBytes += Buffer.byteLength(header, 'utf8');

    for (const table of tables) {
      // Stream table contents as INSERT statements
      const result = await this.pool.query(`SELECT * FROM "${table}" LIMIT 10000`);
      if (result.rows.length > 0) {
        const block = _rowsToInsertSql(table, result.rows);
        const buf = Buffer.from(block, 'utf8');
        dataStream.push(buf);
        hash.update(buf);
        totalBytes += buf.length;
      }
    }

    dataStream.push(null); // end stream
    await writePromise;

    const checksum = hash.digest('hex');
    const durationMs = Date.now() - startMs;

    await this.pool.query(
      `INSERT INTO street_backups (id, size_bytes, duration_ms, checksum, storage_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [backupId, totalBytes, durationMs, checksum, storageKey]
    );

    return backupId;
  }

  /**
   * Restores from a backup, verifying SHA-256 checksum before applying.
   */
  async restore(backupId: string, targetPool?: GenericPool): Promise<void> {
    const dest = targetPool ?? this.pool;

    const result = await this.pool.query(
      'SELECT checksum, storage_key FROM street_backups WHERE id = $1',
      [backupId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Backup not found: ${backupId}`);
    }

    const { checksum, storage_key } = result.rows[0] as { checksum: string; storage_key: string };

    const stream = await this.storage.read(storage_key);

    // Verify checksum while reading
    const hash = createHash('sha256');
    const sqlChunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        hash.update(chunk);
        sqlChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const actualChecksum = hash.digest('hex');
    if (actualChecksum !== checksum) {
      throw new Error(
        `Backup checksum mismatch for ${backupId}.\nExpected: ${checksum}\nActual:   ${actualChecksum}`
      );
    }

    const sql = Buffer.concat(sqlChunks).toString('utf8');

    // Execute each statement. Strip SQL comment lines so a leading comment
    // block (e.g. the backup header) doesn't swallow the first real statement.
    const statements = sql
      .split(/;(\s*\n|\s*$)/)
      .map((s) => s.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await dest.query(stmt);
    }
  }

  private async _listTables(): Promise<string[]> {
    try {
      const result = await this.pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
      );
      return result.rows.map((r) => String(r['tablename']));
    } catch {
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function _uuid(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as { randomUUID?: () => string }).randomUUID === 'function') {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function _rowsToInsertSql(table: string, rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]).map((c) => `"${c}"`).join(', ');
  const lines: string[] = [];
  for (const row of rows) {
    const values = Object.values(row)
      .map((v) => {
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number' || typeof v === 'boolean') return String(v);
        return `'${String(v).replace(/'/g, "''")}'`;
      })
      .join(', ');
    lines.push(`INSERT INTO "${table}" (${columns}) VALUES (${values});`);
  }
  return lines.join('\n') + '\n';
}

// Export Writable to satisfy potential callers that import the module
void Writable;
void pipeline;
