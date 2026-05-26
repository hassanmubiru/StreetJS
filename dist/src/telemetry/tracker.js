// src/telemetry/tracker.ts
// Telemetry: heap profiling, latency tracking, request counters.
// Bounded ring-buffer retention — never unbounded history.
const MAX_SAMPLES = 1440; // 24h at 1 sample/min
const MAX_LATENCY_SAMPLES = 10_000;
export class TelemetryTracker {
    samples = [];
    latencies = []; // bounded circular
    requestCount = 0;
    errorCount = 0;
    collectTimer;
    constructor(collectIntervalMs = 60_000) {
        this.collectTimer = setInterval(() => this._collect(), collectIntervalMs);
        this.collectTimer.unref();
        // Collect immediately
        this._collect();
    }
    /** Record a completed request latency in nanoseconds */
    recordRequest(latencyNs, isError) {
        this.requestCount++;
        if (isError)
            this.errorCount++;
        const latencyMs = Number(latencyNs) / 1_000_000;
        if (this.latencies.length >= MAX_LATENCY_SAMPLES) {
            this.latencies.shift(); // evict oldest
        }
        this.latencies.push(latencyMs);
    }
    /** Get current metrics snapshot */
    snapshot() {
        const mem = process.memoryUsage();
        return {
            ts: Date.now(),
            heapUsedMb: mem.heapUsed / 1024 / 1024,
            rss: mem.rss / 1024 / 1024,
            latencyP50: this._percentile(50),
            latencyP99: this._percentile(99),
            requestCount: this.requestCount,
            errorCount: this.errorCount,
        };
    }
    /** Get recent samples (bounded) */
    getHistory(count = 60) {
        return this.samples.slice(-Math.min(count, MAX_SAMPLES));
    }
    /** Health check data */
    health() {
        const snap = this.snapshot();
        return {
            status: snap.heapUsedMb < 900 ? 'ok' : 'degraded',
            uptime: process.uptime(),
            pid: process.pid,
            heap: { usedMb: snap.heapUsedMb.toFixed(1), rssMb: snap.rss.toFixed(1) },
            requests: { total: snap.requestCount, errors: snap.errorCount },
            latency: { p50Ms: snap.latencyP50.toFixed(2), p99Ms: snap.latencyP99.toFixed(2) },
            timestamp: new Date().toISOString(),
        };
    }
    _collect() {
        if (this.samples.length >= MAX_SAMPLES) {
            this.samples.shift(); // ring buffer
        }
        this.samples.push(this.snapshot());
    }
    _percentile(pct) {
        if (this.latencies.length === 0)
            return 0;
        const sorted = [...this.latencies].sort((a, b) => a - b);
        const idx = Math.ceil((pct / 100) * sorted.length) - 1;
        return sorted[Math.max(0, idx)] ?? 0;
    }
    destroy() {
        clearInterval(this.collectTimer);
    }
}
/** Request timing middleware factory */
export function telemetryMiddleware(tracker) {
    return async (ctx, next) => {
        const start = process.hrtime.bigint();
        let isError = false;
        try {
            await next();
        }
        catch (err) {
            isError = true;
            throw err;
        }
        finally {
            const elapsed = process.hrtime.bigint() - start;
            tracker.recordRequest(elapsed, isError);
        }
    };
}
//# sourceMappingURL=tracker.js.map