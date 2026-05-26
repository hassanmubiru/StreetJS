export interface LruOptions {
    maxEntries: number;
    ttlMs: number;
}
export declare class LruCache<K = string, V = unknown> {
    private readonly map;
    private readonly maxEntries;
    private readonly ttlMs;
    private head;
    private tail;
    private readonly sweepTimer;
    constructor(options: LruOptions);
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    delete(key: K): boolean;
    has(key: K): boolean;
    clear(): void;
    get size(): number;
    private _moveToHead;
    private _evictTail;
    private _remove;
    private _detach;
    private _sweepExpired;
    destroy(): void;
}
//# sourceMappingURL=lru.d.ts.map