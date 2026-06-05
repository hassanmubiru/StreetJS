// src/observability/health.ts
// Health Check DSL: typed check registry, parallel execution with timeout, route registration.
// ── HealthCheckRegistry ────────────────────────────────────────────────────────
export class HealthCheckRegistry {
    _checks = new Map();
    _startTime = Date.now();
    /**
     * Register a health check function.
     * Defaults: type='liveness', timeoutMs=5000.
     */
    addCheck(name, fn, opts) {
        this._checks.set(name, {
            fn,
            type: opts?.type ?? 'liveness',
            timeoutMs: opts?.timeoutMs ?? 5000,
        });
    }
    /** Run all liveness checks in parallel. */
    runLiveness() {
        return this._run('liveness');
    }
    /** Run all readiness checks in parallel. */
    runReadiness() {
        const delayMs = parseInt(process.env['STREET_READINESS_DELAY_MS'] ?? '0', 10);
        if (delayMs > 0 && Date.now() < this._startTime + delayMs) {
            const result = {
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
    async _run(type) {
        const entries = [...this._checks.entries()].filter(([, e]) => e.type === type);
        const results = await Promise.allSettled(entries.map(([name, entry]) => this._runOne(name, entry)));
        const checks = {};
        let anyDown = false;
        for (const result of results) {
            if (result.status === 'fulfilled') {
                const { name, checkResult, durationMs } = result.value;
                checks[name] = { ...checkResult, durationMs };
                if (checkResult.status === 'down')
                    anyDown = true;
            }
            // rejected is unlikely because _runOne catches all errors, but guard anyway
        }
        return {
            status: anyDown ? 'degraded' : 'ok',
            checks,
        };
    }
    async _runOne(name, entry) {
        const start = Date.now();
        const timeoutPromise = new Promise((resolve) => {
            const t = setTimeout(() => {
                resolve({ status: 'down', details: { reason: 'timeout' } });
            }, entry.timeoutMs);
            t.unref();
        });
        let checkResult;
        try {
            checkResult = await Promise.race([entry.fn(), timeoutPromise]);
        }
        catch (err) {
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
export function registerHealthRoutes(app, registry) {
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
//# sourceMappingURL=health.js.map