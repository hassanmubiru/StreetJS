import { EventEmitter } from 'node:events';
import type { MiddlewareFn } from '../core/types.js';
export interface GenericPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
    }>;
}
export interface RegionConfig {
    name: string;
    pool: GenericPool;
    primary?: boolean;
    readWeight?: number;
}
export declare class ReplicationCoordinator extends EventEmitter {
    private readonly regions;
    private readonly healthCheckIntervalMs;
    private healthTimer;
    constructor(regions: RegionConfig[], opts?: {
        healthCheckIntervalMs?: number;
    });
    /**
     * Returns the write pool (always the primary region).
     */
    getWritePool(): GenericPool;
    /**
     * Returns a read pool, optionally preferring a named region.
     * Falls back to weighted random selection across healthy replicas.
     */
    getReadPool(preferredRegion?: string): GenericPool;
    /**
     * Promotes a region to primary. Emits 'region:promoted' event.
     */
    promotePrimary(regionName: string): Promise<void>;
    stop(): void;
    private _checkHealth;
}
export declare function preferredRegionMiddleware(coordinator: ReplicationCoordinator): MiddlewareFn;
//# sourceMappingURL=replication.d.ts.map