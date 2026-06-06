import { type RedisClientOptions } from '../../transports/resp.js';
import type { CacheTransport } from '../distributed-cache.js';
export declare class RedisCacheTransport implements CacheTransport {
    private readonly client;
    private readonly opts;
    private ready;
    constructor(opts?: RedisClientOptions);
    private _ensure;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlMs?: number): Promise<void>;
    delete(key: string): Promise<void>;
    subscribe(channel: string, handler: (msg: string) => void): () => void;
    publish(channel: string, message: string): Promise<void>;
    close(): void;
}
//# sourceMappingURL=redis.d.ts.map