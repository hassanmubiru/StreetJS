// src/database/mysql/pool.ts
// Bounded MySQL connection pool mirroring the PgPool API.
// Min/max connections, acquire queue, idle-sweep timer — all timers call .unref().
import { EventEmitter } from 'node:events';
import { MysqlConnection } from './wire.js';
// ─── MysqlPool ────────────────────────────────────────────────────────────────
export class MysqlPool {
    connections = [];
    waitQueue = [];
    MAX_WAIT = 100;
    pendingCreations = 0;
    opts;
    sweepTimer;
    closed = false;
    /** Internal EventEmitter for pool lifecycle events (e.g. pool:exhausted). */
    events = new EventEmitter();
    constructor(opts) {
        this.opts = {
            minConnections: opts.minConnections ?? 2,
            maxConnections: opts.maxConnections ?? 10,
            idleTimeoutMs: opts.idleTimeoutMs ?? 30_000,
            acquireTimeoutMs: opts.acquireTimeoutMs ?? 5_000,
            port: opts.port ?? 3306,
            ...opts,
        };
        // Periodic idle-connection sweep — does not prevent process exit
        this.sweepTimer = setInterval(() => this._sweepIdle(), 15_000);
        this.sweepTimer.unref();
    }
    /** Warm up minimum connections eagerly. */
    async initialize() {
        const promises = [];
        for (let i = 0; i < this.opts.minConnections; i++) {
            promises.push(this._createConnection().then(() => undefined));
        }
        await Promise.all(promises);
    }
    async _createConnection() {
        const conn = await MysqlConnection.connect(this.opts);
        const pooled = { conn, lastUsed: Date.now(), inUse: false };
        this.connections.push(pooled);
        return pooled;
    }
    /** Acquire a free connection (or create one up to max, or enqueue). */
    async acquire() {
        if (this.closed)
            throw new Error('MysqlPool is closed');
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
                    }
                    finally {
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
            }
            finally {
                this.pendingCreations--;
            }
        }
        // Wait in bounded queue
        if (this.waitQueue.length >= this.MAX_WAIT) {
            throw new Error('MysqlPool wait queue full');
        }
        // Emit pool:exhausted before enqueuing — listeners can log, alert, etc.
        this.events.emit('pool:exhausted', {
            total: this.connections.length,
            idle: this.connections.filter((p) => !p.inUse).length,
            waiting: this.waitQueue.length,
        });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this.waitQueue.indexOf(waitEntry);
                if (idx !== -1)
                    this.waitQueue.splice(idx, 1);
                reject(new Error('MysqlPool acquire timeout'));
            }, this.opts.acquireTimeoutMs);
            timer.unref();
            const waitEntry = { resolve, reject, timer };
            this.waitQueue.push(waitEntry);
        });
    }
    /** Release a connection back to the pool. */
    release(conn) {
        const pooled = this.connections.find((p) => p.conn === conn);
        if (!pooled)
            return;
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
    _removeConnection(pooled) {
        const idx = this.connections.indexOf(pooled);
        if (idx !== -1)
            this.connections.splice(idx, 1);
    }
    _maybeCreateReplacement() {
        if (this.closed)
            return;
        if (this.connections.length + this.pendingCreations >= this.opts.maxConnections)
            return;
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
    async stream(sql) {
        const conn = await this.acquire();
        const st = conn.queryStream(sql);
        st.once('close', () => this.release(conn));
        return st;
    }
    /** Execute a query with automatic connection management. */
    async query(sql, params) {
        const conn = await this.acquire();
        try {
            return await conn.query(sql, params);
        }
        finally {
            this.release(conn);
        }
    }
    /** Execute a function inside a transaction; auto-rollback on error. */
    async transaction(fn) {
        const conn = await this.acquire();
        try {
            await conn.query('START TRANSACTION');
            const result = await fn(conn);
            await conn.query('COMMIT');
            return result;
        }
        catch (err) {
            try {
                await conn.query('ROLLBACK');
            }
            catch { /* ignore */ }
            throw err;
        }
        finally {
            this.release(conn);
        }
    }
    _sweepIdle() {
        const now = Date.now();
        const toRemove = [];
        for (const p of this.connections) {
            if (!p.inUse && now - p.lastUsed > this.opts.idleTimeoutMs) {
                if (this.connections.length - toRemove.length > this.opts.minConnections) {
                    toRemove.push(p);
                }
            }
        }
        for (const p of toRemove) {
            const idx = this.connections.indexOf(p);
            if (idx !== -1)
                this.connections.splice(idx, 1);
            p.conn.close().catch(() => undefined);
        }
    }
    async close() {
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
    get size() { return this.connections.length; }
    get idle() { return this.connections.filter((p) => !p.inUse).length; }
}
//# sourceMappingURL=pool.js.map