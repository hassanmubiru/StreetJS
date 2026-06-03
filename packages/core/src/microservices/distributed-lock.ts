// src/microservices/distributed-lock.ts
// PostgreSQL advisory lock-based distributed lock.

import { createHash } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LockHandle {
  /** Release the lock. Safe to call multiple times. */
  release(): Promise<void>;
}

type GenericPool = {
  query(sql: string, params?: unknown[]): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number;
    command: string;
  }>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert a string key to a 32-bit integer suitable for pg_advisory_lock.
 * Uses the first 4 bytes of the SHA-256 hash.
 */
function hashKey(key: string): number {
  const buf = createHash('sha256').update(key).digest();
  // Read as signed 32-bit int (Postgres bigint advisory locks use 2x int4)
  return buf.readInt32BE(0);
}

// ── DistributedLock ───────────────────────────────────────────────────────────

export class DistributedLock {
  constructor(private readonly _pool: GenericPool) {}

  /**
   * Acquire an advisory lock for the given key.
   *
   * Uses `pg_try_advisory_lock` (session-level, non-blocking).
   * Retries with exponential backoff until acquired or timeout.
   *
   * @param key    Logical lock key.
   * @param ttlMs  Auto-release after this many ms. Default: 30_000.
   * @returns      A `LockHandle` whose `release()` frees the lock.
   */
  async acquire(key: string, ttlMs = 30_000): Promise<LockHandle> {
    const lockId = hashKey(key);
    const acquired = await this._tryAcquire(lockId);

    if (!acquired) {
      // Retry with backoff (up to 10 attempts)
      let delay = 100;
      let attempts = 0;
      while (attempts < 10) {
        await new Promise((r) => setTimeout(r, delay));
        const retried = await this._tryAcquire(lockId);
        if (retried) break;
        delay = Math.min(delay * 2, 5_000);
        attempts++;
        if (attempts >= 10) {
          throw new Error(`DistributedLock: failed to acquire lock for key "${key}" after ${attempts} attempts`);
        }
      }
    }

    let released = false;

    // TTL auto-release timer
    const timer = setTimeout(async () => {
      if (!released) {
        released = true;
        try {
          await this._pool.query('SELECT pg_advisory_unlock($1)', [lockId]);
        } catch {
          // best-effort
        }
      }
    }, ttlMs);
    if (typeof timer.unref === 'function') timer.unref();

    return {
      release: async () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        await this._pool.query('SELECT pg_advisory_unlock($1)', [lockId]);
      },
    };
  }

  private async _tryAcquire(lockId: number): Promise<boolean> {
    const result = await this._pool.query('SELECT pg_try_advisory_lock($1) AS acquired', [lockId]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row?.['acquired'] === true;
  }
}
