// src/platform/distributed-cache.ts
// Distributed cache abstraction with in-process and transport-backed implementations.
import { EventEmitter } from 'node:events';
import { LruCache } from '../cache/lru.js';
const INVALIDATE_CHANNEL = 'street:invalidate';
const DEFAULT_MAX_ENTRIES = 10_000;
const BYTES_PER_ENTRY_ESTIMATE = 512; // rough estimate
// ---------------------------------------------------------------------------
// InProcessCacheTransport
// ---------------------------------------------------------------------------
export class InProcessCacheTransport {
    lru;
    subs = new Map();
    constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
        this.lru = new LruCache({ maxEntries, ttlMs: 3_600_000 });
    }
    async get(key) {
        return this.lru.get(key) ?? null;
    }
    async set(key, value, ttlMs) {
        void ttlMs; // InProcess TTL is managed by LruCache globally
        this.lru.set(key, value);
    }
    async delete(key) {
        this.lru.delete(key);
    }
    subscribe(channel, handler) {
        if (!this.subs.has(channel))
            this.subs.set(channel, new Set());
        this.subs.get(channel).add(handler);
        return () => {
            this.subs.get(channel)?.delete(handler);
        };
    }
    async publish(channel, message) {
        const handlers = this.subs.get(channel);
        if (handlers) {
            for (const handler of handlers) {
                // Deliver asynchronously to avoid blocking the caller
                setImmediate(() => handler(message));
            }
        }
    }
}
export class DistributedCache {
    transport;
    localLru;
    unsubInvalidate;
    constructor(transport = new InProcessCacheTransport(), opts = {}) {
        this.transport = transport;
        const maxMb = opts.maxMemoryMb ?? 64;
        const maxEntries = Math.max(1, Math.floor((maxMb * 1024 * 1024) / BYTES_PER_ENTRY_ESTIMATE));
        this.localLru = new LruCache({ maxEntries, ttlMs: 3_600_000 });
        // Subscribe to invalidation messages from remote nodes
        this.unsubInvalidate = this.transport.subscribe(INVALIDATE_CHANNEL, (key) => {
            this.localLru.delete(key);
        });
    }
    async get(key) {
        const local = this.localLru.get(key);
        if (local !== undefined)
            return local;
        const remote = await this.transport.get(key);
        if (remote !== null) {
            this.localLru.set(key, remote);
        }
        return remote;
    }
    async set(key, value, ttlMs) {
        this.localLru.set(key, value);
        await this.transport.set(key, value, ttlMs);
    }
    async invalidate(key) {
        this.localLru.delete(key);
        await this.transport.delete(key);
        await this.transport.publish(INVALIDATE_CHANNEL, key);
    }
    destroy() {
        this.unsubInvalidate();
        this.localLru.destroy();
    }
}
// ---------------------------------------------------------------------------
// GlobalConfigService
// ---------------------------------------------------------------------------
export class GlobalConfigService extends EventEmitter {
    cache;
    unsubConfig;
    constructor(cache) {
        super();
        this.cache = cache;
        // Subscribe to config change events published by other nodes
        this.unsubConfig = cache.transport
            ? cache.transport.subscribe('street:config:changed', (msg) => {
                try {
                    const payload = JSON.parse(msg);
                    this.emit('config:changed', payload);
                }
                catch {
                    // ignore malformed messages
                }
            })
            : () => undefined;
    }
    async get(key) {
        return this.cache.get(key);
    }
    async set(key, value) {
        const oldValue = await this.cache.get(key);
        await this.cache.set(key, value);
        const payload = JSON.stringify({ key, oldValue, newValue: value });
        const transport = this.cache.transport;
        if (transport) {
            await transport.publish('street:config:changed', payload);
        }
        this.emit('config:changed', { key, oldValue, newValue: value });
    }
    destroy() {
        this.unsubConfig();
        this.cache.destroy();
    }
}
//# sourceMappingURL=distributed-cache.js.map