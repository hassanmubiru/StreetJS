// src/tests/db-init-mode.test.ts
// Unit tests for DB_INIT_MODE config (Requirement 2.12) and the PgPool lazy
// initialization guard (pool.ensureInitialized()).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AppConfig } from '../config/index.js';
import { PgPool } from '../database/pool.js';

// ── AppConfig.dbInitMode ────────────────────────────────────────────────────────

describe('AppConfig.dbInitMode', () => {
  it('defaults to "lazy" when DB_INIT_MODE is unset', () => {
    const cfg = new AppConfig();
    assert.equal(cfg.dbInitMode, 'lazy');
  });

  it('returns "eager" when set to eager', () => {
    const cfg = new AppConfig();
    cfg.dbInitModeRaw = 'eager';
    assert.equal(cfg.dbInitMode, 'eager');
  });

  it('returns "provisioned" when set to provisioned', () => {
    const cfg = new AppConfig();
    cfg.dbInitModeRaw = 'provisioned';
    assert.equal(cfg.dbInitMode, 'provisioned');
  });

  it('normalizes case and surrounding whitespace', () => {
    const cfg = new AppConfig();
    cfg.dbInitModeRaw = '  EAGER  ';
    assert.equal(cfg.dbInitMode, 'eager');
  });

  it('falls back to "lazy" for an unrecognized value (boots without a DB)', () => {
    const cfg = new AppConfig();
    cfg.dbInitModeRaw = 'nonsense';
    assert.equal(cfg.dbInitMode, 'lazy');
  });
});

// ── PgPool.ensureInitialized() ──────────────────────────────────────────────────

/** Build a pool with a tiny acquire timeout pointed at an unused local port. */
function makePool(minConnections: number): PgPool {
  return new PgPool({
    host: '127.0.0.1',
    // Port 1 is privileged/unused — connect is refused immediately on localhost.
    port: 1,
    user: 'nobody',
    password: 'nopass',
    database: 'none',
    minConnections,
    maxConnections: 4,
    idleTimeoutMs: 1_000,
    acquireTimeoutMs: 200,
  });
}

describe('PgPool.ensureInitialized()', () => {
  it('warms up with no database when minConnections is 0 (lazy bootstrap)', async () => {
    const pool = makePool(0);
    try {
      await pool.ensureInitialized();
      assert.equal(pool.size, 0);
    } finally {
      await pool.close();
    }
  });

  it('is idempotent: initialize() runs at most once across concurrent calls', async () => {
    const pool = makePool(0);
    let calls = 0;
    const original = pool.initialize.bind(pool);
    pool.initialize = async () => {
      calls++;
      return original();
    };

    try {
      await Promise.all([
        pool.ensureInitialized(),
        pool.ensureInitialized(),
        pool.ensureInitialized(),
      ]);
      assert.equal(calls, 1);

      // A later call after success is a no-op.
      await pool.ensureInitialized();
      assert.equal(calls, 1);
    } finally {
      await pool.close();
    }
  });

  it('is retryable: a failed warm-up clears state so the next call retries', async () => {
    const pool = makePool(1); // requires a real connection -> will fail (refused)
    let calls = 0;
    const original = pool.initialize.bind(pool);
    pool.initialize = async () => {
      calls++;
      return original();
    };

    try {
      await assert.rejects(pool.ensureInitialized());
      assert.equal(calls, 1);

      // Because the failed attempt cleared the cached promise, this retries.
      await assert.rejects(pool.ensureInitialized());
      assert.equal(calls, 2);
    } finally {
      await pool.close();
    }
  });

  it('throws on a closed pool that was never initialized', async () => {
    const pool = makePool(0);
    await pool.close();
    await assert.rejects(pool.ensureInitialized(), /closed/i);
  });
});
