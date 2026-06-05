// src/database/sqlite/worker.ts
// SQLite worker — runs inside a node:worker_threads thread.
//
// Loads the SQLite WASM binary (via the official @sqlite.org/sqlite-wasm
// Emscripten JS glue) and handles `query` / `transaction` messages sent from
// the main thread via MessageChannel ports.
//
// Message protocol:
//   Ready    ← { type: 'ready' }                           (worker → pool, once on startup)
//   Request  → { id, type: 'query',       sql, params? }
//            → { id, type: 'transaction',  ops: Array<{ sql, params? }> }
//   Response ← { id, ok: true,  result: DbResult }
//            ← { id, ok: false, error:  string   }

import { workerData, isMainThread, parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { DbResult } from '../types.js';

// ─── Type declarations for the @sqlite.org/sqlite-wasm OO1 API ────────────────

interface SqliteRow {
  [column: string]: unknown;
}

interface ExecOptions {
  bind?: unknown[];
  rowMode?: 'object' | 'array';
  resultRows?: SqliteRow[];
}

interface OO1Database {
  exec(sql: string, opts?: ExecOptions): void;
  changes(): number;
  transaction<T>(fn: () => T): T;
  close(): void;
}

interface Sqlite3Module {
  oo1: {
    DB: new (path: string) => OO1Database;
  };
  version: {
    libVersion: string;
  };
}

// ─── Message types ─────────────────────────────────────────────────────────────

interface QueryRequest {
  id: number;
  type: 'query';
  sql: string;
  params?: unknown[];
}

interface TransactionOp {
  sql: string;
  params?: unknown[];
}

interface TransactionRequest {
  id: number;
  type: 'transaction';
  ops: TransactionOp[];
}

type WorkerRequest = QueryRequest | TransactionRequest;

interface SuccessResponse {
  id: number;
  ok: true;
  result: DbResult;
}

interface ErrorResponse {
  id: number;
  ok: false;
  error: string;
}

type WorkerResponse = SuccessResponse | ErrorResponse;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive the SQL command tag from the first token of the statement.
 * Mirrors the PostgreSQL CommandComplete tag for API consistency.
 */
function commandTag(sql: string): string {
  const token = sql.trimStart().split(/\s+/)[0];
  return token ? token.toUpperCase() : 'UNKNOWN';
}

/**
 * Normalise a row returned by SQLite OO1 exec (rowMode: 'object') to the
 * `Record<string, string | null>` shape required by `DbResult`.
 */
function normaliseRow(row: SqliteRow): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, val] of Object.entries(row)) {
    if (val === null || val === undefined) {
      out[key] = null;
    } else {
      out[key] = String(val);
    }
  }
  return out;
}

/**
 * Execute a single SQL statement against an open DB, returning a `DbResult`.
 */
function execOne(
  db: OO1Database,
  sql: string,
  params?: unknown[],
): DbResult {
  const rows: SqliteRow[] = [];
  const opts: ExecOptions = { rowMode: 'object', resultRows: rows };
  if (params && params.length > 0) {
    opts.bind = params;
  }
  db.exec(sql, opts);

  const normalisedRows = rows.map(normaliseRow);
  const cmd = commandTag(sql);

  // For DML statements (INSERT/UPDATE/DELETE) use db.changes(); for
  // everything else (SELECT, DDL …) use the number of returned rows.
  let rowCount: number;
  if (cmd === 'INSERT' || cmd === 'UPDATE' || cmd === 'DELETE') {
    rowCount = db.changes();
  } else {
    rowCount = normalisedRows.length;
  }

  return { rows: normalisedRows, rowCount, command: cmd };
}

// ─── Worker bootstrap ─────────────────────────────────────────────────────────

if (!isMainThread) {
  const { filePath } = workerData as { filePath: string };

  // Resolve the WASM glue module relative to this worker file.
  // In the compiled output the file lives next to the JS glue wrapper.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const gluePath = join(__dirname, 'sqlite3-node.mjs');

  // The glue module is a plain ESM file that imports `node:fs`, `node:path`,
  // etc. via require() internally.  We make `require` available on globalThis
  // for the rare case the WASM module needs it (Emscripten MODULARIZE build).
  const _require = createRequire(import.meta.url);
  (globalThis as Record<string, unknown>)['require'] = _require;

  // Dynamically import the glue code and open the database.
  let db: OO1Database | null = null;

  type GlueModule = { default: (opts?: Record<string, unknown>) => Promise<Sqlite3Module> };
  const glue = await (import(gluePath) as Promise<GlueModule>);
  const sqlite3: Sqlite3Module = await glue.default({
    // Tell the Emscripten runtime where to find sqlite3.wasm
    locateFile: (name: string) => join(__dirname, name),
  });

  db = new sqlite3.oo1.DB(filePath);

  // Signal to the pool that this worker is ready to accept messages.
  parentPort!.postMessage({ type: 'ready' });

  parentPort!.on('message', (req: WorkerRequest) => {
    // Defensively extract the correlation id first: a malformed message must
    // never cause the error-response construction itself to throw (which would
    // surface as an uncaught exception and crash the worker). A non-numeric id
    // is replaced with -1, which the pool ignores as an unmatched response.
    const rawId = (req as { id?: unknown } | null | undefined)?.id;
    const id = typeof rawId === 'number' ? rawId : -1;

    if (!db) {
      const resp: ErrorResponse = { id, ok: false, error: 'Database is closed' };
      parentPort!.postMessage(resp);
      return;
    }

    let resp: WorkerResponse;
    try {
      if (req?.type === 'query') {
        const result = execOne(db, req.sql, req.params);
        resp = { id, ok: true, result };
      } else if (req?.type === 'transaction') {
        // transaction — run all ops atomically; return result of last op
        if (!Array.isArray(req.ops)) {
          throw new Error("transaction message requires an 'ops' array");
        }
        let lastResult: DbResult = { rows: [], rowCount: 0, command: 'BEGIN' };
        db.transaction(() => {
          for (const op of req.ops) {
            lastResult = execOne(db!, op.sql, op.params);
          }
        });
        resp = { id, ok: true, result: lastResult };
      } else {
        // Unknown or malformed message — report instead of crashing.
        throw new Error('Unknown or malformed worker message');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      resp = { id, ok: false, error: msg };
    }

    parentPort!.postMessage(resp);
  });

  // Close the database cleanly when the worker is told to exit.
  parentPort!.on('close', () => {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
      db = null;
    }
  });
}
