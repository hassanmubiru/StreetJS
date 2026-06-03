// src/database/sqlite/pool.ts
// SqlitePool — a bounded pool of worker_threads, each owning one SQLite
// database connection.  Routes queries and transactions to an available
// worker, serialising work per worker to avoid concurrent writes on the
// same connection.

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { DbResult } from '../types.js';

// ─── Options ──────────────────────────────────────────────────────────────────

export interface SqlitePoolOptions {
  /** Path to the SQLite database file.  Use `':memory:'` for in-memory DBs. */
  filePath: string;
  /**
   * Maximum number of worker threads.
   * Defaults to 4.  Because SQLite allows only one writer at a time,
   * values beyond the number of concurrent readers rarely help for
   * write-heavy workloads.
   */
  maxWorkers?: number;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface WorkerEntry {
  worker: Worker;
  busy: boolean;
}

interface Waiter {
  resolve: (entry: WorkerEntry) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** Acquire-timeout for a free worker (10 s — workers need time to load WASM). */
const ACQUIRE_TIMEOUT_MS = 10_000;

/** Bounded size of the waiter queue (prevents unbounded memory growth). */
const MAX_WAIT_QUEUE = 64;

// ─── SqlitePool ───────────────────────────────────────────────────────────────

export class SqlitePool {
  private readonly filePath: string;
  private readonly maxWorkers: number;
  private readonly workers: WorkerEntry[] = [];
  private readonly waitQueue: Waiter[] = [];
  private pendingCreations = 0;
  private closed = false;

  /** Next message-id counter (shared across all workers; just needs to be unique). */
  private nextId = 1;

  constructor(opts: SqlitePoolOptions) {
    this.filePath = opts.filePath;
    this.maxWorkers = opts.maxWorkers ?? 4;
  }

  // ── Worker management ───────────────────────────────────────────────────────

  private _workerPath(): string {
    // Works for both the compiled (dist/) and source (src/) trees because
    // the worker file is always co-located with this pool file.
    const __dir = dirname(fileURLToPath(import.meta.url));
    return join(__dir, 'worker.js');
  }

  /**
   * Spawn a new worker and wait for it to signal `{ type: 'ready' }` before
   * adding it to the pool.  The WASM module initialisation is async, so
   * without this handshake the pool could send messages before the worker
   * is listening.
   */
  private _createWorker(): Promise<WorkerEntry> {
    return new Promise<WorkerEntry>((resolve, reject) => {
      const worker = new Worker(this._workerPath(), {
        workerData: { filePath: this.filePath },
      });

      const entry: WorkerEntry = { worker, busy: false };

      // One-shot ready listener — removed as soon as the worker is ready
      // or errors out during startup.
      const onReady = (msg: { type?: string }) => {
        if (msg.type !== 'ready') return;
        worker.off('message', onReady);
        worker.off('error', onStartupError);
        this.workers.push(entry);

        // After startup: surface runtime worker errors by removing the entry
        worker.on('error', (_err: Error) => {
          entry.busy = false;
          const idx = this.workers.indexOf(entry);
          if (idx !== -1) this.workers.splice(idx, 1);
          this._drainQueue();
        });

        resolve(entry);
      };

      const onStartupError = (err: Error) => {
        worker.off('message', onReady);
        reject(err);
      };

      worker.on('message', onReady);
      worker.once('error', onStartupError);
    });
  }

  private _drainQueue(): void {
    // Service waiters with existing free workers first
    while (this.waitQueue.length > 0) {
      const free = this.workers.find((e) => !e.busy);
      if (free) {
        const waiter = this.waitQueue.shift()!;
        clearTimeout(waiter.timer);
        free.busy = true;
        waiter.resolve(free);
      } else {
        break;
      }
    }

    // Spin up new workers for remaining waiters if there is room
    while (
      this.waitQueue.length > 0 &&
      this.workers.length + this.pendingCreations < this.maxWorkers
    ) {
      this.pendingCreations++;
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timer);
      this._createWorker().then((entry) => {
        entry.busy = true;
        waiter.resolve(entry);
      }).catch((err: Error) => {
        waiter.reject(err);
      }).finally(() => {
        this.pendingCreations--;
      });
    }
  }

  private _acquire(): Promise<WorkerEntry> {
    if (this.closed) return Promise.reject(new Error('SqlitePool is closed'));

    // Try a free existing worker
    const free = this.workers.find((e) => !e.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }

    // Spin up a new worker if under limit (accounting for in-flight creations)
    if (this.workers.length + this.pendingCreations < this.maxWorkers) {
      this.pendingCreations++;
      return this._createWorker().then((entry) => {
        entry.busy = true;
        return entry;
      }).finally(() => {
        this.pendingCreations--;
      });
    }

    // Wait for a worker to become free
    if (this.waitQueue.length >= MAX_WAIT_QUEUE) {
      return Promise.reject(new Error('SqlitePool wait queue full'));
    }

    return new Promise<WorkerEntry>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.indexOf(waiter);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error('SqlitePool acquire timeout'));
      }, ACQUIRE_TIMEOUT_MS);
      timer.unref();

      const waiter: Waiter = { resolve, reject, timer };
      this.waitQueue.push(waiter);
    });
  }

  private _release(entry: WorkerEntry): void {
    entry.busy = false;
    this._drainQueue();
  }

  // ── Messaging helpers ───────────────────────────────────────────────────────

  private _send<T>(
    entry: WorkerEntry,
    msg: Record<string, unknown>,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const onMessage = (response: { id: number; type?: string; ok: boolean; result?: T; error?: string }) => {
        // Skip the 'ready' message if it somehow arrives here
        if (response.type === 'ready') return;
        if (response.id !== id) return;
        entry.worker.off('message', onMessage);
        if (response.ok) {
          resolve(response.result as T);
        } else {
          reject(new Error(response.error ?? 'Unknown SQLite worker error'));
        }
      };
      entry.worker.on('message', onMessage);
      entry.worker.postMessage({ ...msg, id });
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Execute a single SQL statement.
   *
   * @param sql    SQL string, optionally with `?` positional placeholders.
   * @param params Positional parameter values.
   * @returns      Resolved `DbResult` (rows, rowCount, command).
   */
  async query(sql: string, params?: unknown[]): Promise<DbResult> {
    const entry = await this._acquire();
    try {
      return await this._send<DbResult>(entry, { type: 'query', sql, params: params ?? [] });
    } finally {
      this._release(entry);
    }
  }

  /**
   * Execute a user-supplied function inside a serialised SQLite transaction.
   *
   * The callback receives a `query` helper bound to the same worker connection.
   * If the callback throws (or returns a rejected promise) the transaction is
   * rolled back automatically; otherwise it is committed.
   *
   * Because each worker owns a single SQLite connection, the transaction is
   * guaranteed to run on one connection with no interleaving.
   *
   * @param fn  Async callback that performs the transactional operations.
   * @returns   The value returned by `fn`.
   */
  async transaction<T>(
    fn: (query: (sql: string, params?: unknown[]) => Promise<DbResult>) => Promise<T>,
  ): Promise<T> {
    const entry = await this._acquire();
    try {
      // Start the transaction on the worker's connection
      await this._send<DbResult>(entry, { type: 'query', sql: 'BEGIN', params: [] });

      // Provide a query helper that runs each statement on the same worker
      // while the transaction is open, returning real results to the callback.
      const txQuery = (sql: string, params?: unknown[]): Promise<DbResult> =>
        this._send<DbResult>(entry, { type: 'query', sql, params: params ?? [] });

      let result: T;
      try {
        result = await fn(txQuery);
        await this._send<DbResult>(entry, { type: 'query', sql: 'COMMIT', params: [] });
      } catch (err) {
        // Best-effort rollback; swallow secondary errors
        try {
          await this._send<DbResult>(entry, { type: 'query', sql: 'ROLLBACK', params: [] });
        } catch {
          // Ignore rollback error
        }
        throw err;
      }

      return result;
    } finally {
      this._release(entry);
    }
  }

  /**
   * Gracefully close all worker threads.
   * Any in-flight queries will complete; subsequent calls throw.
   */
  async close(): Promise<void> {
    this.closed = true;

    // Reject pending waiters
    const err = new Error('SqlitePool is closed');
    for (const w of this.waitQueue.splice(0)) {
      clearTimeout(w.timer);
      w.reject(err);
    }

    // Terminate all workers
    await Promise.all(
      this.workers.map((e) =>
        e.worker.terminate().catch(() => undefined),
      ),
    );
    this.workers.length = 0;
  }
}
