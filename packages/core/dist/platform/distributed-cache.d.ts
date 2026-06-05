import { EventEmitter } from 'node:events';
export interface CacheTransport {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlMs?: number): Promise<void>;
    delete(key: string): Promise<void>;
    subscribe(channel: string, handler: (msg: string) => void): () => void;
    publish(channel: string, message: string): Promise<void>;
}
export declare class InProcessCacheTransport implements CacheTransport {
    private readonly lru;
    private readonly subs;
    constructor(maxEntries?: number);
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlMs?: number): Promise<void>;
    delete(key: string): Promise<void>;
    subscribe(channel: string, handler: (msg: string) => void): () => void;
    publish(channel: string, message: string): Promise<void>;
}
export interface DistributedCacheOptions {
    maxMemoryMb?: number;
}
export declare class DistributedCache {
    private readonly transport;
    private readonly localLru;
    private readonly unsubInvalidate;
    constructor(transport?: CacheTransport, opts?: DistributedCacheOptions);
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlMs?: number): Promise<void>;
    invalidate(key: string): Promise<void>;
    destroy(): void;
}
export declare class GlobalConfigService extends EventEmitter {
    private readonly cache;
    private readonly unsubConfig;
    constructor(cache: DistributedCache);
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    destroy(): void;
}
//# sourceMappingURL=distributed-cache.d.ts.map