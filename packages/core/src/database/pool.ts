// src/database/pool.ts
// Bounded PostgreSQL connection pool with health checking and backpressure.

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
    await Promise.all(promises);
  }

  private async _createConnection(): Promise<PooledConnection> {
    const conn = await PgConnection.connect(this.opts);
    const pooled: PooledConnection = { conn, lastUsed: Date.now(), inUse: false };
    this.connections.push(pooled);
    return pooled;
  }

  /** Acquire a free connection (or create one up to max, or wait) */
  async acquire(): Promise<PgConnection> {
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
}
