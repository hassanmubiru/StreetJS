// src/database/pool.ts
// Bounded PostgreSQL connection pool with health checking and backpressure.

import { PgConnection, type PgConnectOptions, type PgResult } from './wire.js';
import { Injectable } from '../core/container.js';

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

@Injectable()
export class PgPool {
  private readonly connections: PooledConnection[] = [];
  private readonly waitQueue: Array<(conn: PgConnection) => void> = [];
  private readonly MAX_WAIT = 100; // bounded wait queue
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

    // Find idle healthy connection
    for (const p of this.connections) {
      if (!p.inUse && p.conn.isReady) {
        p.inUse = true;
        p.lastUsed = Date.now();
        return p.conn;
      }
    }

    // Create new if under limit
    if (this.connections.length < this.opts.maxConnections) {
      const pooled = await this._createConnection();
      pooled.inUse = true;
      return pooled.conn;
    }

    // Wait in queue (bounded)
    if (this.waitQueue.length >= this.MAX_WAIT) {
      throw new Error('Connection pool wait queue full');
    }

    return new Promise<PgConnection>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = this.waitQueue.indexOf(resolve);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        reject(new Error('Connection acquire timeout'));
      }, this.opts.acquireTimeoutMs);
      timeout.unref();

      this.waitQueue.push(resolve);
    });
  }

  /** Release connection back to pool */
  release(conn: PgConnection): void {
    const pooled = this.connections.find((p) => p.conn === conn);
    if (!pooled) return;

    pooled.inUse = false;
    pooled.lastUsed = Date.now();

    // Service waiting callers
    const waiter = this.waitQueue.shift();
    if (waiter && pooled.conn.isReady) {
      pooled.inUse = true;
      waiter(pooled.conn);
    }
  }

  /** Execute a query with automatic connection management */
  async query(sql: string): Promise<PgResult> {
    const conn = await this.acquire();
    try {
      return await conn.query(sql);
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
    const waiters = this.waitQueue.splice(0);
    for (const waiter of waiters) {
      waiter(Promise.reject(new Error('Connection pool is closed')) as unknown as PgConnection);
    }

    await Promise.all(this.connections.map((p) => p.conn.close().catch(() => undefined)));
    this.connections.length = 0;
  }

  get size(): number { return this.connections.length; }
  get idle(): number { return this.connections.filter((p) => !p.inUse).length; }
}
