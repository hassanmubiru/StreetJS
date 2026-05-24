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
import { PgConnection } from './wire.js';
import { Injectable } from '../core/container.js';
let PgPool = class PgPool {
    connections = [];
    waitQueue = [];
    MAX_WAIT = 100; // bounded wait queue
    opts;
    sweepTimer;
    closed = false;
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
        await Promise.all(promises);
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
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const idx = this.waitQueue.indexOf(resolve);
                if (idx !== -1)
                    this.waitQueue.splice(idx, 1);
                reject(new Error('Connection acquire timeout'));
            }, this.opts.acquireTimeoutMs);
            timeout.unref();
            this.waitQueue.push(resolve);
        });
    }
    /** Release connection back to pool */
    release(conn) {
        const pooled = this.connections.find((p) => p.conn === conn);
        if (!pooled)
            return;
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
    async query(sql) {
        const conn = await this.acquire();
        try {
            return await conn.query(sql);
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
//# sourceMappingURL=pool.js.map