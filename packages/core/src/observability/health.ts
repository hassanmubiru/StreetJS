// src/observability/health.ts
// Health Check DSL: typed check registry, parallel execution with timeout, route registration.

import type { StreetApp } from '../http/server.js';

// ── Types & Interfaces ────────────────────────────────────────────────────────

export type CheckType = 'liveness' | 'readiness';
export type CheckStatus = 'up' | 'down';

export interface CheckResult {
  status: CheckStatus;
  details?: Record<string, unknown>;
}

export type CheckFn = () => Promise<CheckResult>;

export interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: Record<string, CheckResult & { durationMs: number }>;
}

// ── Internal registry entry ───────────────────────────────────────────────────

interface CheckEntry {
  fn: CheckFn;
  type: CheckType;
  timeoutMs: number;
}

// ── HealthCheckRegistry ────────────────────────────────────────────────────────

export class HealthCheckRegistry {
  private readonly _checks = new Map<string, CheckEntry>();
  private readonly _startTime = Date.now();

  /**
   * Register a health check function.
   * Defaults: type='liveness', timeoutMs=5000.
   */
  addCheck(
    name: string,
    fn: CheckFn,
    opts?: { type?: CheckType; timeoutMs?: number },
  ): void {
    this._checks.set(name, {
      fn,
      type: opts?.type ?? 'liveness',
      timeoutMs: opts?.timeoutMs ?? 5000,
    });
  }

  /** Run all liveness checks in parallel. */
  runLiveness(): Promise<HealthResponse> {
    return this._run('liveness');
  }

  /** Run all readiness checks in parallel. */
  runReadiness(): Promise<HealthResponse> {
    const delayMs = parseInt(process.env['STREET_READINESS_DELAY_MS'] ?? '0', 10);
    if (delayMs > 0 && Date.now() < this._startTime + delayMs) {
      const result: HealthResponse = {
        status: 'degraded',
        checks: {
          readiness_delay: {
            status: 'down',
            durationMs: 0,
            details: { reason: 'startup_delay', remainingMs: (this._startTime + delayMs) - Date.now() },
          },
        },
      };
      return Promise.resolve(result);
    }
    return this._run('readiness');
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _run(type: CheckType): Promise<HealthResponse> {
    const entries = [...this._checks.entries()].filter(([, e]) => e.type === type);

    const results = await Promise.allSettled(
      entries.map(([name, entry]) => this._runOne(name, entry)),
    );

    const checks: HealthResponse['checks'] = {};
    let anyDown = false;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { name, checkResult, durationMs } = result.value;
        checks[name] = { ...checkResult, durationMs };
        if (checkResult.status === 'down') anyDown = true;
      }
      // rejected is unlikely because _runOne catches all errors, but guard anyway
    }

    return {
      status: anyDown ? 'degraded' : 'ok',
      checks,
    };
  }

  private async _runOne(
    name: string,
    entry: CheckEntry,
  ): Promise<{ name: string; checkResult: CheckResult; durationMs: number }> {
    const start = Date.now();

    const timeoutPromise: Promise<CheckResult> = new Promise((resolve) => {
      const t = setTimeout(() => {
        resolve({ status: 'down', details: { reason: 'timeout' } });
      }, entry.timeoutMs);
      t.unref();
    });

    let checkResult: CheckResult;
    try {
      checkResult = await Promise.race([entry.fn(), timeoutPromise]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checkResult = { status: 'down', details: { error: message } };
    }

    const durationMs = Date.now() - start;
    return { name, checkResult, durationMs };
  }
}

// ── Database readiness as a declared provisioned dependency ───────────────────

export interface DbReadinessCheckOptions {
  /**
   * Whether a database is configured/expected for this deployment.
   *
   * When `false`, the database is an *undeclared* dependency: there is nothing to
   * be ready for, so the check reports `up`. This is what lets a deployment with
   * no provisioned PostgreSQL serve `/health/ready` 200 within budget (Req 2.12).
   *
   * When `true`, the database is a *declared provisioned dependency* and the
   * `probe` decides reachability: `up` when reachable, `down` only when the
   * configured database is unreachable.
   */
  expected: boolean;
  /**
   * Reachability probe used only when `expected` is `true`. Resolves on a
   * successful round-trip and rejects when the database is unreachable. Ignored
   * entirely when `expected` is `false`, so it is never invoked in the no-DB case.
   */
  probe: () => Promise<void>;
  /**
   * Maximum time to wait for the probe before reporting the database `down`.
   * Kept below the 5s health SLA so `/health/ready` always answers within budget
   * even when the configured database hangs. Defaults to 4000ms.
   */
  probeTimeoutMs?: number;
}

/**
 * Build a readiness check that treats the database as a *declared provisioned
 * dependency* (Requirement 2.12 / design "Lazy database initialization").
 *
 * Semantics:
 *  - no database configured/expected → `up` (immediately, without probing)
 *  - database configured + reachable → `up`
 *  - database configured + unreachable (or probe times out) → `down`
 *
 * This check is intended to be registered with `type: 'readiness'` only. Liveness
 * never registers a database check, so `/health/live` never depends on the DB.
 */
export function createDbReadinessCheck(opts: DbReadinessCheckOptions): CheckFn {
  const probeTimeoutMs = opts.probeTimeoutMs ?? 4000;

  return async (): Promise<CheckResult> => {
    // No declared dependency: there is no database to be ready for.
    if (!opts.expected) {
      return { status: 'up', details: { dependency: 'postgres', state: 'not-configured' } };
    }

    // Declared dependency: gate readiness on a bounded reachability probe.
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<CheckResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: 'down', details: { dependency: 'postgres', reason: 'timeout' } }),
        probeTimeoutMs,
      );
      timer.unref();
    });

    const probe: Promise<CheckResult> = opts
      .probe()
      .then((): CheckResult => ({ status: 'up', details: { dependency: 'postgres', state: 'reachable' } }))
      .catch((err): CheckResult => ({
        status: 'down',
        details: {
          dependency: 'postgres',
          reason: 'unreachable',
          error: err instanceof Error ? err.message : String(err),
        },
      }));

    try {
      return await Promise.race([probe, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

// ── Route registration ────────────────────────────────────────────────────────

/**
 * Register GET /health/live and GET /health/ready on a StreetApp instance.
 * Responds 200 if all checks pass, 503 if any check is down.
 */
export function registerHealthRoutes(
  app: StreetApp,
  registry: HealthCheckRegistry,
): void {
  app.use(async (ctx, next) => {
    if (ctx.method === 'GET' && ctx.path === '/health/live') {
      const response = await registry.runLiveness();
      ctx.json({ ...response }, response.status === 'ok' ? 200 : 503);
      return;
    }
    if (ctx.method === 'GET' && ctx.path === '/health/ready') {
      const response = await registry.runReadiness();
      ctx.json({ ...response }, response.status === 'ok' ? 200 : 503);
      return;
    }
    await next();
  });
}
