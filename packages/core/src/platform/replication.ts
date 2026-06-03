// src/platform/replication.ts
// Multi-region replication coordinator with primary health monitoring and weighted read routing.

import { EventEmitter } from 'node:events';
import type { MiddlewareFn } from '../core/types.js';

// ---------------------------------------------------------------------------
// GenericPool interface
// ---------------------------------------------------------------------------

export interface GenericPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

// ---------------------------------------------------------------------------
// RegionConfig
// ---------------------------------------------------------------------------

export interface RegionConfig {
  name: string;
  pool: GenericPool;
  primary?: boolean;
  readWeight?: number;
}

// ---------------------------------------------------------------------------
// ReplicationCoordinator
// ---------------------------------------------------------------------------

interface RegionState {
  config: RegionConfig;
  healthy: boolean;
  isPrimary: boolean;
}

export class ReplicationCoordinator extends EventEmitter {
  private readonly regions: RegionState[];
  private readonly healthCheckIntervalMs: number;
  private healthTimer: NodeJS.Timeout | null = null;

  constructor(
    regions: RegionConfig[],
    opts: { healthCheckIntervalMs?: number } = {}
  ) {
    super();
    this.healthCheckIntervalMs = opts.healthCheckIntervalMs ?? 10_000;

    this.regions = regions.map((r) => ({
      config: r,
      healthy: true,
      isPrimary: r.primary === true,
    }));

    // Ensure exactly one primary
    const primaries = this.regions.filter((r) => r.isPrimary);
    if (primaries.length === 0 && this.regions.length > 0) {
      this.regions[0]!.isPrimary = true;
    }

    // Start health monitoring
    if (this.healthCheckIntervalMs > 0) {
      this.healthTimer = setInterval(() => void this._checkHealth(), this.healthCheckIntervalMs);
      this.healthTimer.unref();
    }
  }

  /**
   * Returns the write pool (always the primary region).
   */
  getWritePool(): GenericPool {
    const primary = this.regions.find((r) => r.isPrimary && r.healthy);
    if (!primary) {
      throw new Error('No healthy primary region available');
    }
    return primary.config.pool;
  }

  /**
   * Returns a read pool, optionally preferring a named region.
   * Falls back to weighted random selection across healthy replicas.
   */
  getReadPool(preferredRegion?: string): GenericPool {
    if (preferredRegion) {
      const preferred = this.regions.find(
        (r) => r.config.name === preferredRegion && r.healthy
      );
      if (preferred) return preferred.config.pool;
    }

    const healthy = this.regions.filter((r) => r.healthy);
    if (healthy.length === 0) throw new Error('No healthy regions available');

    // Weighted random selection
    const total = healthy.reduce((sum, r) => sum + (r.config.readWeight ?? 1), 0);
    let rand = Math.random() * total;
    for (const r of healthy) {
      rand -= r.config.readWeight ?? 1;
      if (rand <= 0) return r.config.pool;
    }
    return healthy[healthy.length - 1]!.config.pool;
  }

  /**
   * Promotes a region to primary. Emits 'region:promoted' event.
   */
  async promotePrimary(regionName: string): Promise<void> {
    const target = this.regions.find((r) => r.config.name === regionName);
    if (!target) throw new Error(`Region not found: ${regionName}`);
    if (!target.healthy) throw new Error(`Cannot promote unhealthy region: ${regionName}`);

    const oldPrimary = this.regions.find((r) => r.isPrimary);
    if (oldPrimary) oldPrimary.isPrimary = false;

    target.isPrimary = true;

    this.emit('region:promoted', {
      region: regionName,
      formerPrimary: oldPrimary?.config.name,
    });
  }

  stop(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async _checkHealth(): Promise<void> {
    for (const region of this.regions) {
      try {
        await region.config.pool.query('SELECT 1');
        region.healthy = true;
      } catch {
        region.healthy = false;

        // Auto-promote next healthy non-primary if primary fails
        if (region.isPrimary) {
          region.isPrimary = false;
          const next = this.regions.find((r) => r.healthy && !r.isPrimary);
          if (next) {
            next.isPrimary = true;
            this.emit('region:promoted', {
              region: next.config.name,
              formerPrimary: region.config.name,
              reason: 'health-failure',
            });
          }
        }

        this.emit('region:unhealthy', { region: region.config.name });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// preferredRegionMiddleware
// ---------------------------------------------------------------------------

export function preferredRegionMiddleware(
  coordinator: ReplicationCoordinator
): MiddlewareFn {
  return async (ctx, next) => {
    const preferredRegion = ctx.headers['x-preferred-region'] as string | undefined;

    try {
      const pool = coordinator.getReadPool(preferredRegion);
      ctx.state['readPool'] = pool;
    } catch {
      // No healthy pool — allow request to proceed without a pool override
    }

    await next();
  };
}
