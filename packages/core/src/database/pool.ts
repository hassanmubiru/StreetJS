// src/database/pool.ts
// Bounded PostgreSQL connection pool with health checking and backpressure.

import { EventEmitter } from 'node:events';
import { PgConnection, type PgConnectOptions, type PgResult, type StreetPostgresWireStream } from './wire.js';
import { Injectable } from '../core/container.js';
import { DatabaseConnectionError } from '../http/exceptions.js';

export interface PoolOptions extends PgConnectOptions {
  minConnections?: number;
  maxConnections?: number;
  idleTimeoutMs?: number;
  acquireTimeoutMs?: number;
}

interface PooledConnection {
  conn: PgConnection;
  lastUsed: number;
  inUse: boolean;
}

interface WaitEntry {
  resolve: (conn: PgConnection) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

@Injectable()
export class PgPool {
  private readonly connections: PooledConnection[] = [];
  private readonly waitQueue: WaitEntry[] = [];
  private readonly MAX_WAIT = 100; // bounded wait queue
  private pendingCreations = 0; // track in-flight connection creation
  private readonly opts: {
    host: string; port: number; user: string; password: string; database: string;
    connectTimeoutMs?: number;
    minConnections: number; maxConnections: number;
    idleTimeoutMs: number; acquireTimeoutMs: number;
  };
  private readonly sweepTimer: NodeJS.Timeout;
  private closed = false;

  /** Whether the pool has completed (or is completing) its initial warm-up. */
  private initialized = false;
  /** In-flight warm-up promise, shared by concurrent callers for idempotency. */
  private initPromise: Promise<void> | null = null;

  /** Rolling window of recent successful acquire durations (ms). */
  private static readonly ACQUIRE_SAMPLE_SIZE = 100;
  private readonly acquireSamples: number[] = [];
  private acquireSamplesHead = 0;
  private acquireSamplesCount = 0;

  /** Internal EventEmitter for pool lifecycle events (e.g. pool:exhausted). */
  readonly events: EventEmitter = new EventEmitter();

  constructor(opts: PoolOptions) {
    this.opts = {
      minConnections: opts.minConnections ?? 2,
      maxConnections: opts.maxConnections ?? 10,
      idleTimeoutMs: opts.idleTimeoutMs ?? 30_000,
      acquireTimeoutMs: opts.acquireTimeoutMs ?? 5_000,
      ...opts,
    };

    // Periodic sweep of idle connections
    this.sweepTimer = setInterval(() => this._sweepIdle(), 15_000);
    this.sweepTimer.unref();
  }

  /** Warm up minimum connections */
  async initialize(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.opts.minConnections; i++) {
      promises.push(this._createConnection().then(() => undefined));
    }
    try {
      await Promise.all(promises);
      this.initialized = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ECONNREFUSED') {
        throw new DatabaseConnectionError(
          `Cannot connect to PostgreSQL at ${this.opts.host}:${this.opts.port}: connection refused`,
          `Check that the database is running and that the following environment variables are correct: ` +
            `PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE`
        );
      }
      throw err;
    }
  }

  /**
   * Idempotent, lazy warm-up guard.
   *
   * Ensures the pool's minimum connections are established exactly once. Safe to
   * call repeatedly and concurrently: the first call performs the warm-up, later
   * calls return immediately (or await the in-flight warm-up). This lets a pool be
   * registered at bootstrap without a database, then warm up on first acquire/query.
   *
   * If warm-up fails (e.g. the database is unreachable), the cached promise is
   * cleared so a subsequent call can retry once the database becomes available.
   */
  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.closed) throw new Error('Pool is closed');
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.initialize()
      .catch((err) => {
        // Allow a later call to retry once the database is reachable.
        this.initPromise = null;
        throw err;
      });
    return this.initPromise;
  }

  private async _createConnection(): Promise<PooledConnection> {
    const conn = await PgConnection.connect(this.opts);
    const pooled: PooledConnection = { conn, lastUsed: Date.now(), inUse: false };
    this.connections.push(pooled);
    return pooled;
  }

  /** Acquire a free connection (or create one up to max, or wait) */
  async acquire(): Promise<PgConnection> {
    // Lazy warm-up: the first acquire (or query/stream/transaction, which all
    // funnel through here) initializes the pool on demand. Idempotent thereafter.
    //
    // For an ALREADY-initialized pool we must not introduce an extra `await`
    // boundary here: that microtask yield would let a concurrent close() run
    // before _doAcquire enqueues this caller as a waiter, so the caller would
    // hit the synchronous "Pool is closed" guard instead of being rejected as a
    // queued waiter with "Connection pool is closed". _doAcquire enqueues the
    // waiter synchronously (no await before waitQueue.push), so calling it in
    // the same tick keeps close()'s waiter-rejection contract correct.
    //
    // We therefore only await initialization on the cold path (the first
    // acquire, when `initialized` is still false). On the warm path we skip the
    // await entirely and call _doAcquire() in the same tick, so the waiter is
    // enqueued synchronously with the acquire() call.
    if (!this.initialized) {
      await this.ensureInitialized();
    }
    const start = Date.now();
    const conn = await this._doAcquire();
    // Record only successful acquires so timeouts/failures don't skew the average
    this._recordAcquire(Date.now() - start);
    return conn;
  }

  private async _doAcquire(): Promise<PgConnection> {
    if (this.closed) throw new Error('Pool is closed');

    // Find idle healthy connection, cleaning up dead ones encountered along the way
    for (const p of this.connections) {
      if (p.conn.isClosed) {
        // Dead connection — remove it from the pool and create a replacement
        this._removeConnection(p);
        // Create replacement if under max
        if (this.connections.length + this.pendingCreations < this.opts.maxConnections) {
          this.pendingCreations++;
          try {
            const replacement = await this._createConnection();
            replacement.inUse = true;
            return replacement.conn;
          } finally {
            this.pendingCreations--;
          }
        }
        // Fall through to wait queue if we can't create a replacement
        break;
      }
      if (!p.inUse && p.conn.isReady) {
        p.inUse = true;
        p.lastUsed = Date.now();
        return p.conn;
      }
    }

    // Create new if under limit (account for in-flight connections)
    if (this.connections.length + this.pendingCreations < this.opts.maxConnections) {
      this.pendingCreations++;
      try {
        const pooled = await this._createConnection();
        pooled.inUse = true;
        return pooled.conn;
      } finally {
        this.pendingCreations--;
      }
    }

    // Wait in queue (bounded)
    if (this.waitQueue.length >= this.MAX_WAIT) {
      throw new Error('Connection pool wait queue full');
    }

    // Emit pool:exhausted before enqueuing — listeners can log, alert, etc.
    this.events.emit('pool:exhausted', {
      total: this.connections.length,
      idle: this.connections.filter((p) => !p.inUse).length,
      waiting: this.waitQueue.length,
    });

    return new Promise<PgConnection>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.waitQueue.indexOf(waitEntry);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error('Connection acquire timeout'));
      }, this.opts.acquireTimeoutMs);
      timeout.unref();

      const waitEntry: WaitEntry = { resolve, reject, timer: timeout };
      this.waitQueue.push(waitEntry);
    });
  }

  /** Release connection back to pool */
  release(conn: PgConnection): void {
    const pooled = this.connections.find((p) => p.conn === conn);
    if (!pooled) return;

    // If connection died while in use, remove it and create replacement if needed
    if (pooled.conn.isClosed) {
      this._removeConnection(pooled);
      this._maybeCreateReplacement();
      return;
    }

    pooled.inUse = false;
    pooled.lastUsed = Date.now();

    // Service waiting callers — only if connection is healthy
    if (pooled.conn.isReady) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        pooled.inUse = true;
        clearTimeout(waiter.timer);
        waiter.resolve(pooled.conn);
      }
    }
  }

  /** Remove a pooled connection from the connections array */
  private _removeConnection(pooled: PooledConnection): void {
    const idx = this.connections.indexOf(pooled);
    if (idx !== -1) this.connections.splice(idx, 1);
  }

  /** Create a replacement connection if under max and not closed */
  private _maybeCreateReplacement(): void {
    if (this.closed) return;
    if (this.connections.length + this.pendingCreations >= this.opts.maxConnections) return;

    this.pendingCreations++;
    this._createConnection().then((pooled) => {
      // Serve a waiter with the new connection if one is waiting
      const waiter = this.waitQueue.shift();
      if (waiter) {
        pooled.inUse = true;
        clearTimeout(waiter.timer);
        waiter.resolve(pooled.conn);
      }
    }).catch(() => {
      // Replacement failed — nothing to do
    }).finally(() => {
      this.pendingCreations--;
    });
  }

  /** Execute a streaming query — automatically manages acquire/release */
  async stream(sql: string): Promise<StreetPostgresWireStream> {
    const conn = await this.acquire();
    const stream = conn.queryStream(sql);
    // 'close' fires after 'end' (success) or 'error' (failure) — covers both
    stream.once('close', () => this.release(conn));
    return stream;
  }

  /** Execute a query with automatic connection management */
  // Note: OTel child-span instrumentation for DB queries requires passing StreetContext
  // into pool.query(), which is a significant API change planned for v2.x.
  // Use the otelMiddleware for HTTP-level spans and correlate manually via correlationId.
  async query(sql: string, params?: unknown[]): Promise<PgResult> {
    const conn = await this.acquire();
    try {
      return await conn.query(sql, params);
    } finally {
      this.release(conn);
    }
  }

  /** Execute in a transaction */
  async transaction<T>(fn: (conn: PgConnection) => Promise<T>): Promise<T> {
    const conn = await this.acquire();
    try {
      await conn.query('BEGIN');
      const result = await fn(conn);
      await conn.query('COMMIT');
      return result;
    } catch (err) {
      try { await conn.query('ROLLBACK'); } catch { /* ignore rollback error */ }
      throw err;
    } finally {
      this.release(conn);
    }
  }

  private _sweepIdle(): void {
    const now = Date.now();
    const toRemove: PooledConnection[] = [];

    for (const p of this.connections) {
      if (!p.inUse && now - p.lastUsed > this.opts.idleTimeoutMs) {
        if (this.connections.length - toRemove.length > this.opts.minConnections) {
          toRemove.push(p);
        }
      }
    }

    for (const p of toRemove) {
      const idx = this.connections.indexOf(p);
      if (idx !== -1) this.connections.splice(idx, 1);
      p.conn.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.sweepTimer);

    // Reject all pending waiters to prevent hanging promises
    const err = new Error('Connection pool is closed');
    const waiters = this.waitQueue.splice(0);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }

    await Promise.all(this.connections.map((p) => p.conn.close().catch(() => undefined)));
    this.connections.length = 0;
  }

  get size(): number { return this.connections.length; }
  get idle(): number { return this.connections.filter((p) => !p.inUse).length; }

  /** Number of callers currently waiting for a connection. */
  get waiting(): number { return this.waitQueue.length; }

  /** Rolling average of recent successful acquire durations (ms); 0 if none recorded. */
  get avgAcquireMs(): number {
    if (this.acquireSamplesCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.acquireSamplesCount; i++) {
      sum += this.acquireSamples[i] ?? 0;
    }
    return sum / this.acquireSamplesCount;
  }

  /** Record a successful acquire duration into the rolling window. */
  private _recordAcquire(durationMs: number): void {
    this.acquireSamples[this.acquireSamplesHead] = durationMs;
    this.acquireSamplesHead = (this.acquireSamplesHead + 1) % PgPool.ACQUIRE_SAMPLE_SIZE;
    if (this.acquireSamplesCount < PgPool.ACQUIRE_SAMPLE_SIZE) this.acquireSamplesCount++;
  }
}

/**
 * Helper to subscribe to `pool:exhausted` events emitted by `PgPool`.
 *
 * @param pool  The PgPool instance to listen on.
 * @param fn    Callback invoked with pool state at exhaustion time.
 * @returns     An `off` function that removes the listener when called.
 */
export function onPoolExhausted(
  pool: PgPool,
  fn: (state: { total: number; idle: number; waiting: number }) => void,
): () => void {
  pool.events.on('pool:exhausted', fn);
  return () => pool.events.off('pool:exhausted', fn);
}
