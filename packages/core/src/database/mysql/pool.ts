// src/database/mysql/pool.ts
// Bounded MySQL connection pool mirroring the PgPool API.
// Min/max connections, acquire queue, idle-sweep timer — all timers call .unref().

import { MysqlConnection, type MysqlConnectOptions, type MysqlResultStream } from './wire.js';
import type { DbResult } from '../types.js';

// ─── Options ──────────────────────────────────────────────────────────────────
export interface MysqlPoolOptions extends MysqlConnectOptions {
  minConnections?: number;
  maxConnections?: number;
  idleTimeoutMs?: number;
  acquireTimeoutMs?: number;
}

// ─── Internal types ───────────────────────────────────────────────────────────
interface PooledConnection {
  conn: MysqlConnection;
  lastUsed: number;
  inUse: boolean;
}

interface WaitEntry {
  resolve: (conn: MysqlConnection) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

// ─── MysqlPool ────────────────────────────────────────────────────────────────
export class MysqlPool {
  private readonly connections: PooledConnection[] = [];
  private readonly waitQueue: WaitEntry[] = [];
  private readonly MAX_WAIT = 100;
  private pendingCreations = 0;
  private readonly opts: {
    host: string; port: number; user: string; password: string; database: string;
    connectTimeoutMs?: number;
    minConnections: number; maxConnections: number;
    idleTimeoutMs: number; acquireTimeoutMs: number;
  };
  private readonly sweepTimer: NodeJS.Timeout;
  private closed = false;

  constructor(opts: MysqlPoolOptions) {
    this.opts = {
      minConnections:   opts.minConnections   ?? 2,
      maxConnections:   opts.maxConnections   ?? 10,
      idleTimeoutMs:    opts.idleTimeoutMs    ?? 30_000,
      acquireTimeoutMs: opts.acquireTimeoutMs ?? 5_000,
      port: opts.port ?? 3306,
      ...opts,
    };

    // Periodic idle-connection sweep — does not prevent process exit
    this.sweepTimer = setInterval(() => this._sweepIdle(), 15_000);
    this.sweepTimer.unref();
  }


  /** Warm up minimum connections eagerly. */
  async initialize(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.opts.minConnections; i++) {
      promises.push(this._createConnection().then(() => undefined));
    }
    await Promise.all(promises);
  }

  private async _createConnection(): Promise<PooledConnection> {
    const conn = await MysqlConnection.connect(this.opts);
    const pooled: PooledConnection = { conn, lastUsed: Date.now(), inUse: false };
    this.connections.push(pooled);
    return pooled;
  }

  /** Acquire a free connection (or create one up to max, or enqueue). */
  async acquire(): Promise<MysqlConnection> {
    if (this.closed) throw new Error('MysqlPool is closed');

    // Scan for a healthy idle connection
    for (const p of this.connections) {
      if (p.conn.isClosed) {
        this._removeConnection(p);
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
        break;
      }
      if (!p.inUse && p.conn.isReady) {
        p.inUse = true;
        p.lastUsed = Date.now();
        return p.conn;
      }
    }

    // Spin up a new connection if under limit
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

    // Wait in bounded queue
    if (this.waitQueue.length >= this.MAX_WAIT) {
      throw new Error('MysqlPool wait queue full');
    }

    return new Promise<MysqlConnection>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.indexOf(waitEntry);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error('MysqlPool acquire timeout'));
      }, this.opts.acquireTimeoutMs);
      timer.unref();

      const waitEntry: WaitEntry = { resolve, reject, timer };
      this.waitQueue.push(waitEntry);
    });
  }

  /** Release a connection back to the pool. */
  release(conn: MysqlConnection): void {
    const pooled = this.connections.find((p) => p.conn === conn);
    if (!pooled) return;

    if (pooled.conn.isClosed) {
      this._removeConnection(pooled);
      this._maybeCreateReplacement();
      return;
    }

    pooled.inUse = false;
    pooled.lastUsed = Date.now();

    if (pooled.conn.isReady) {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        pooled.inUse = true;
        clearTimeout(waiter.timer);
        waiter.resolve(pooled.conn);
      }
    }
  }

  private _removeConnection(pooled: PooledConnection): void {
    const idx = this.connections.indexOf(pooled);
    if (idx !== -1) this.connections.splice(idx, 1);
  }

  private _maybeCreateReplacement(): void {
    if (this.closed) return;
    if (this.connections.length + this.pendingCreations >= this.opts.maxConnections) return;

    this.pendingCreations++;
    this._createConnection().then((pooled) => {
      const waiter = this.waitQueue.shift();
      if (waiter) {
        pooled.inUse = true;
        clearTimeout(waiter.timer);
        waiter.resolve(pooled.conn);
      }
    }).catch(() => {
      // replacement failed — nothing to do
    }).finally(() => {
      this.pendingCreations--;
    });
  }


  /** Stream query results with automatic connection management. */
  async stream(sql: string): Promise<MysqlResultStream> {
    const conn = await this.acquire();
    const st = conn.queryStream(sql);
    st.once('close', () => this.release(conn));
    return st;
  }

  /** Execute a query with automatic connection management. */
  async query(sql: string, params?: unknown[]): Promise<DbResult> {
    const conn = await this.acquire();
    try {
      return await conn.query(sql, params);
    } finally {
      this.release(conn);
    }
  }

  /** Execute a function inside a transaction; auto-rollback on error. */
  async transaction<T>(fn: (conn: MysqlConnection) => Promise<T>): Promise<T> {
    const conn = await this.acquire();
    try {
      await conn.query('START TRANSACTION');
      const result = await fn(conn);
      await conn.query('COMMIT');
      return result;
    } catch (err) {
      try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
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

    const err = new Error('MysqlPool is closed');
    const waiters = this.waitQueue.splice(0);
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }

    await Promise.all(this.connections.map((p) => p.conn.close().catch(() => undefined)));
    this.connections.length = 0;
  }

  get size(): number  { return this.connections.length; }
  get idle(): number  { return this.connections.filter((p) => !p.inUse).length; }
}
