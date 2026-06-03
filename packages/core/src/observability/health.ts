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
