import type { CacheTransport } from '../distributed-cache.js';
export interface MemcachedOptions {
    host?: string;
    port?: number;
}
export declare class MemcachedTransport implements CacheTransport {
    private readonly host;
    private readonly port;
    private socket;
    private buffer;
    private readonly waiters;
    private readonly subs;
    constructor(opts?: MemcachedOptions);
    private _ensure;
    private _command;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlMs?: number): Promise<void>;
    delete(key: string): Promise<void>;
    subscribe(channel: string, handler: (msg: string) => void): () => void;
    publish(channel: string, message: string): Promise<void>;
    close(): void;
}
//# sourceMappingURL=memcached.d.ts.map