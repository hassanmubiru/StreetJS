// In-process telemetry tracker with bounded ring-buffer retention.
// Heap/RSS sampling, request counters, and p50/p99 latency percentiles.

/** A single telemetry sample. */
export interface TelemetrySample {
  ts: number;
  heapUsedMb: number;
  rss: number;
  latencyP50: number;
  latencyP99: number;
  requestCount: number;
  errorCount: number;
}

const MAX_SAMPLES = 1440; // 24h at 1 sample/min
const MAX_LATENCY_SAMPLES = 10_000;

export class TelemetryTracker {
  private readonly samples: TelemetrySample[] = [];
  private readonly latencies: number[] = []; // bounded circular
  private requestCount = 0;
  private errorCount = 0;
  private readonly collectTimer: NodeJS.Timeout;

  constructor(collectIntervalMs = 60_000) {
    this.collectTimer = setInterval(() => this.collect(), collectIntervalMs);
    this.collectTimer.unref();
    // Collect an initial sample immediately.
    this.collect();
  }

  /** Record a completed request latency in nanoseconds. */
  recordRequest(latencyNs: bigint, isError: boolean): void {
    this.requestCount++;
    if (isError) {
      this.errorCount++;
    }

    const latencyMs = Number(latencyNs) / 1_000_000;
    if (this.latencies.length >= MAX_LATENCY_SAMPLES) {
      this.latencies.shift(); // evict oldest
    }
    this.latencies.push(latencyMs);
  }

  /** Current metrics snapshot. */
  snapshot(): TelemetrySample {
    const mem = process.memoryUsage();
    return {
      ts: Date.now(),
      heapUsedMb: mem.heapUsed / 1024 / 1024,
      rss: mem.rss / 1024 / 1024,
      latencyP50: this.percentile(50),
      latencyP99: this.percentile(99),
      requestCount: this.requestCount,
      errorCount: this.errorCount,
    };
  }

  /** Recent samples (bounded to the retention window). */
  getHistory(count = 60): TelemetrySample[] {
    return this.samples.slice(-Math.min(count, MAX_SAMPLES));
  }

  /** Health-check data derived from the current snapshot. */
  health(): object {
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

  private collect(): void {
    if (this.samples.length >= MAX_SAMPLES) {
      this.samples.shift(); // ring buffer
    }
    this.samples.push(this.snapshot());
  }

  private percentile(pct: number): number {
    if (this.latencies.length === 0) {
      return 0;
    }
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.ceil((pct / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  }

  /** Stop the background collection timer. */
  destroy(): void {
    clearInterval(this.collectTimer);
  }
}
