// src/platform/distributed-cache.ts
// Distributed cache abstraction with in-process and transport-backed implementations.

import { EventEmitter } from 'node:events';
import { LruCache } from '../cache/lru.js';

const INVALIDATE_CHANNEL = 'street:invalidate';
const DEFAULT_MAX_ENTRIES = 10_000;
const BYTES_PER_ENTRY_ESTIMATE = 512; // rough estimate

// ---------------------------------------------------------------------------
// CacheTransport interface
// ---------------------------------------------------------------------------

export interface CacheTransport {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  subscribe(channel: string, handler: (msg: string) => void): () => void;
  publish(channel: string, message: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// InProcessCacheTransport
// ---------------------------------------------------------------------------

export class InProcessCacheTransport implements CacheTransport {
  private readonly lru: LruCache<string, string>;
  private readonly subs = new Map<string, Set<(msg: string) => void>>();

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.lru = new LruCache<string, string>({ maxEntries, ttlMs: 3_600_000 });
  }

  async get(key: string): Promise<string | null> {
    return this.lru.get(key) ?? null;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    void ttlMs; // InProcess TTL is managed by LruCache globally
    this.lru.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.lru.delete(key);
  }

  subscribe(channel: string, handler: (msg: string) => void): () => void {
    if (!this.subs.has(channel)) this.subs.set(channel, new Set());
    this.subs.get(channel)!.add(handler);
    return () => {
      this.subs.get(channel)?.delete(handler);
    };
  }

  async publish(channel: string, message: string): Promise<void> {
    const handlers = this.subs.get(channel);
    if (handlers) {
      for (const handler of handlers) {
        // Deliver asynchronously to avoid blocking the caller
        setImmediate(() => handler(message));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// DistributedCache
// ---------------------------------------------------------------------------

export interface DistributedCacheOptions {
  maxMemoryMb?: number;
}

export class DistributedCache {
  private readonly transport: CacheTransport;
  private readonly localLru: LruCache<string, string>;
  private readonly unsubInvalidate: () => void;

  constructor(
    transport: CacheTransport = new InProcessCacheTransport(),
    opts: DistributedCacheOptions = {}
  ) {
    this.transport = transport;

    const maxMb = opts.maxMemoryMb ?? 64;
    const maxEntries = Math.max(1, Math.floor((maxMb * 1024 * 1024) / BYTES_PER_ENTRY_ESTIMATE));
    this.localLru = new LruCache<string, string>({ maxEntries, ttlMs: 3_600_000 });

    // Subscribe to invalidation messages from remote nodes
    this.unsubInvalidate = this.transport.subscribe(INVALIDATE_CHANNEL, (key: string) => {
      this.localLru.delete(key);
    });
  }

  async get(key: string): Promise<string | null> {
    const local = this.localLru.get(key);
    if (local !== undefined) return local;

    const remote = await this.transport.get(key);
    if (remote !== null) {
      this.localLru.set(key, remote);
    }
    return remote;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.localLru.set(key, value);
    await this.transport.set(key, value, ttlMs);
  }

  async invalidate(key: string): Promise<void> {
    this.localLru.delete(key);
    await this.transport.delete(key);
    await this.transport.publish(INVALIDATE_CHANNEL, key);
  }

  destroy(): void {
    this.unsubInvalidate();
    this.localLru.destroy();
  }
}

// ---------------------------------------------------------------------------
// GlobalConfigService
// ---------------------------------------------------------------------------

export class GlobalConfigService extends EventEmitter {
  private readonly cache: DistributedCache;
  private readonly unsubConfig: () => void;

  constructor(cache: DistributedCache) {
    super();
    this.cache = cache;

    // Subscribe to config change events published by other nodes
    this.unsubConfig = (cache as unknown as { transport: CacheTransport }).transport
      ? (cache as unknown as { transport: CacheTransport }).transport.subscribe(
          'street:config:changed',
          (msg: string) => {
            try {
              const payload = JSON.parse(msg) as { key: string; oldValue: string | null; newValue: string };
              this.emit('config:changed', payload);
            } catch {
              // ignore malformed messages
            }
          }
        )
      : () => undefined;
  }

  async get(key: string): Promise<string | null> {
    return this.cache.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    const oldValue = await this.cache.get(key);
    await this.cache.set(key, value);

    const payload = JSON.stringify({ key, oldValue, newValue: value });
    const transport = (this.cache as unknown as { transport: CacheTransport }).transport;
    if (transport) {
      await transport.publish('street:config:changed', payload);
    }

    this.emit('config:changed', { key, oldValue, newValue: value });
  }

  destroy(): void {
    this.unsubConfig();
    this.cache.destroy();
  }
}
