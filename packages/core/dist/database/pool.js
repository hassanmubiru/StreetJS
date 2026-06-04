// src/database/pool.ts
// Bounded PostgreSQL connection pool with health checking and backpressure.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { EventEmitter } from 'node:events';
import { PgConnection } from './wire.js';
import { Injectable } from '../core/container.js';
import { DatabaseConnectionError } from '../http/exceptions.js';
let PgPool = class PgPool {
    connections = [];
    waitQueue = [];
    MAX_WAIT = 100; // bounded wait queue
    pendingCreations = 0; // track in-flight connection creation
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
            ...opts,
        };
        // Periodic sweep of idle connections
        this.sweepTimer = setInterval(() => this._sweepIdle(), 15_000);
        this.sweepTimer.unref();
    }
    /** Warm up minimum connections */
    async initialize() {
        const promises = [];
        for (let i = 0; i < this.opts.minConnections; i++) {
            promises.push(this._createConnection().then(() => undefined));
        }
        try {
            await Promise.all(promises);
        }
        catch (err) {
            const code = err.code;
            if (code === 'ECONNREFUSED') {
                throw new DatabaseConnectionError(`Cannot connect to PostgreSQL at ${this.opts.host}:${this.opts.port}: connection refused`, `Check that the database is running and that the following environment variables are correct: ` +
                    `PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE`);
            }
            throw err;
        }
    }
    async _createConnection() {
        const conn = await PgConnection.connect(this.opts);
        const pooled = { conn, lastUsed: Date.now(), inUse: false };
        this.connections.push(pooled);
        return pooled;
    }
    /** Acquire a free connection (or create one up to max, or wait) */
    async acquire() {
        if (this.closed)
            throw new Error('Pool is closed');
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
                    }
                    finally {
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
            }
            finally {
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
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const idx = this.waitQueue.indexOf(waitEntry);
                if (idx !== -1)
                    this.waitQueue.splice(idx, 1);
                reject(new Error('Connection acquire timeout'));
            }, this.opts.acquireTimeoutMs);
            timeout.unref();
            const waitEntry = { resolve, reject, timer: timeout };
            this.waitQueue.push(waitEntry);
        });
    }
    /** Release connection back to pool */
    release(conn) {
        const pooled = this.connections.find((p) => p.conn === conn);
        if (!pooled)
            return;
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
    _removeConnection(pooled) {
        const idx = this.connections.indexOf(pooled);
        if (idx !== -1)
            this.connections.splice(idx, 1);
    }
    /** Create a replacement connection if under max and not closed */
    _maybeCreateReplacement() {
        if (this.closed)
            return;
        if (this.connections.length + this.pendingCreations >= this.opts.maxConnections)
            return;
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
    async stream(sql) {
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
    async query(sql, params) {
        const conn = await this.acquire();
        try {
            return await conn.query(sql, params);
        }
        finally {
            this.release(conn);
        }
    }
    /** Execute in a transaction */
    async transaction(fn) {
        const conn = await this.acquire();
        try {
            await conn.query('BEGIN');
            const result = await fn(conn);
            await conn.query('COMMIT');
            return result;
        }
        catch (err) {
            try {
                await conn.query('ROLLBACK');
            }
            catch { /* ignore rollback error */ }
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
    get size() { return this.connections.length; }
    get idle() { return this.connections.filter((p) => !p.inUse).length; }
};
PgPool = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [Object])
], PgPool);
export { PgPool };
/**
 * Helper to subscribe to `pool:exhausted` events emitted by `PgPool`.
 *
 * @param pool  The PgPool instance to listen on.
 * @param fn    Callback invoked with pool state at exhaustion time.
 * @returns     An `off` function that removes the listener when called.
 */
export function onPoolExhausted(pool, fn) {
    pool.events.on('pool:exhausted', fn);
    return () => pool.events.off('pool:exhausted', fn);
}
//# sourceMappingURL=pool.js.map