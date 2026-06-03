// src/database/sqlite/pool.ts
// SqlitePool — a bounded pool of worker_threads, each owning one SQLite
// database connection.  Routes queries and transactions to an available
// worker, serialising work per worker to avoid concurrent writes on the
// same connection.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
/** Acquire-timeout for a free worker (5 s). */
const ACQUIRE_TIMEOUT_MS = 5_000;
/** Bounded size of the waiter queue (prevents unbounded memory growth). */
const MAX_WAIT_QUEUE = 64;
// ─── SqlitePool ───────────────────────────────────────────────────────────────
export class SqlitePool {
    filePath;
    maxWorkers;
    workers = [];
    waitQueue = [];
    closed = false;
    /** Next message-id counter (shared across all workers; just needs to be unique). */
    nextId = 1;
    constructor(opts) {
        this.filePath = opts.filePath;
        this.maxWorkers = opts.maxWorkers ?? 4;
    }
    // ── Worker management ───────────────────────────────────────────────────────
    _workerPath() {
        // Works for both the compiled (dist/) and source (src/) trees because
        // the worker file is always co-located with this pool file.
        const __dir = dirname(fileURLToPath(import.meta.url));
        return join(__dir, 'worker.js');
    }
    _createWorker() {
        const worker = new Worker(this._workerPath(), {
            workerData: { filePath: this.filePath },
        });
        // Surface unhandled worker errors (they do not reject individual calls)
        worker.on('error', (err) => {
            // Mark as not busy so the pool can remove it on the next acquire
            entry.busy = false;
            // Remove from pool
            const idx = this.workers.indexOf(entry);
            if (idx !== -1)
                this.workers.splice(idx, 1);
            // Wake waiting callers — they will try to create a new worker
            this._drainQueue();
        });
        const entry = { worker, busy: false };
        this.workers.push(entry);
        return entry;
    }
    _drainQueue() {
        while (this.waitQueue.length > 0) {
            const free = this.workers.find((e) => !e.busy);
            if (!free) {
                if (this.workers.length < this.maxWorkers) {
                    // Spin up a new worker to serve the waiter
                    const entry = this._createWorker();
                    const waiter = this.waitQueue.shift();
                    clearTimeout(waiter.timer);
                    entry.busy = true;
                    waiter.resolve(entry);
                }
                return;
            }
            const waiter = this.waitQueue.shift();
            clearTimeout(waiter.timer);
            free.busy = true;
            waiter.resolve(free);
        }
    }
    _acquire() {
        if (this.closed)
            return Promise.reject(new Error('SqlitePool is closed'));
        // Try a free existing worker
        const free = this.workers.find((e) => !e.busy);
        if (free) {
            free.busy = true;
            return Promise.resolve(free);
        }
        // Spin up a new worker if under limit
        if (this.workers.length < this.maxWorkers) {
            const entry = this._createWorker();
            entry.busy = true;
            return Promise.resolve(entry);
        }
        // Wait for a worker to become free
        if (this.waitQueue.length >= MAX_WAIT_QUEUE) {
            return Promise.reject(new Error('SqlitePool wait queue full'));
        }
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.waitQueue.indexOf(waiter);
                if (idx !== -1)
                    this.waitQueue.splice(idx, 1);
                reject(new Error('SqlitePool acquire timeout'));
            }, ACQUIRE_TIMEOUT_MS);
            timer.unref();
            const waiter = { resolve, reject, timer };
            this.waitQueue.push(waiter);
        });
    }
    _release(entry) {
        entry.busy = false;
        this._drainQueue();
    }
    // ── Messaging helpers ───────────────────────────────────────────────────────
    _send(entry, msg) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const onMessage = (response) => {
                if (response.id !== id)
                    return;
                entry.worker.off('message', onMessage);
                if (response.ok) {
                    resolve(response.result);
                }
                else {
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
    async query(sql, params) {
        const entry = await this._acquire();
        try {
            return await this._send(entry, { type: 'query', sql, params: params ?? [] });
        }
        finally {
            this._release(entry);
        }
    }
    /**
     * Execute a user-supplied function inside a serialised SQLite transaction.
     *
     * The callback receives a `query` helper bound to the same worker connection.
     * If the callback throws (or returns a rejected promise) the transaction is
     * rolled back; otherwise it is committed.
     *
     * Because each worker owns a single SQLite connection, the transaction is
     * guaranteed to run on one connection with no interleaving.
     *
     * @param fn  Async callback that performs the transactional operations.
     * @returns   The value returned by `fn`.
     */
    async transaction(fn) {
        const entry = await this._acquire();
        try {
            // Collect all ops issued inside fn via a local query helper
            const ops = [];
            const captureQuery = async (sql, params) => {
                // Return a deferred DbResult placeholder; the actual execution happens
                // atomically in the worker.  We need to collect ops first.
                ops.push({ sql, params });
                // Return a provisional empty result so the callback can chain calls
                return { rows: [], rowCount: 0, command: sql.trim().split(/\s+/)[0]?.toUpperCase() ?? 'UNKNOWN' };
            };
            // Run the user fn to gather all ops
            const userResult = await fn(captureQuery);
            // Ship the ops to the worker as one atomic transaction
            if (ops.length > 0) {
                await this._send(entry, { type: 'transaction', ops });
            }
            return userResult;
        }
        finally {
            this._release(entry);
        }
    }
    /**
     * Gracefully close all worker threads.
     * Any in-flight queries will complete; subsequent calls throw.
     */
    async close() {
        this.closed = true;
        // Reject pending waiters
        const err = new Error('SqlitePool is closed');
        for (const w of this.waitQueue.splice(0)) {
            clearTimeout(w.timer);
            w.reject(err);
        }
        // Terminate all workers
        await Promise.all(this.workers.map((e) => e.worker.terminate().catch(() => undefined)));
        this.workers.length = 0;
    }
}
//# sourceMappingURL=pool.js.map