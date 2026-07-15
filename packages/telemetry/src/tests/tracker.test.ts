import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TelemetryTracker } from '../tracker.js';
import { TELEMETRY_TRACKER } from '../index.js';

// Use a long interval so the background timer never fires during a test; the
// constructor collects one sample immediately, which is enough.
function tracker(): TelemetryTracker {
  return new TelemetryTracker(3_600_000);
}

test('snapshot reports memory, counters, and latency fields', () => {
  const t = tracker();
  try {
    const s = t.snapshot();
    assert.equal(typeof s.ts, 'number');
    assert.ok(s.heapUsedMb > 0);
    assert.ok(s.rss > 0);
    assert.equal(s.requestCount, 0);
    assert.equal(s.errorCount, 0);
    assert.equal(s.latencyP50, 0); // no latencies yet
    assert.equal(s.latencyP99, 0);
  } finally {
    t.destroy();
  }
});

test('recordRequest increments counters and tracks errors', () => {
  const t = tracker();
  try {
    t.recordRequest(1_000_000n, false); // 1 ms
    t.recordRequest(2_000_000n, true); // 2 ms, error
    const s = t.snapshot();
    assert.equal(s.requestCount, 2);
    assert.equal(s.errorCount, 1);
  } finally {
    t.destroy();
  }
});

test('percentiles reflect recorded latencies', () => {
  const t = tracker();
  try {
    // 1..100 ms
    for (let i = 1; i <= 100; i++) t.recordRequest(BigInt(i) * 1_000_000n, false);
    const s = t.snapshot();
    // p50 ≈ 50 ms, p99 ≈ 99 ms (ceil(pct/100 * n) - 1 indexing)
    assert.equal(s.latencyP50, 50);
    assert.equal(s.latencyP99, 99);
  } finally {
    t.destroy();
  }
});

test('getHistory returns the collected samples (bounded)', () => {
  const t = tracker();
  try {
    // Constructor collected one sample immediately.
    const hist = t.getHistory();
    assert.ok(Array.isArray(hist));
    assert.ok(hist.length >= 1);
    assert.equal(typeof hist[0].heapUsedMb, 'number');
    assert.equal(t.getHistory(0).length, 0); // clamp to count
  } finally {
    t.destroy();
  }
});

test('health summarizes status and counters', () => {
  const t = tracker();
  try {
    t.recordRequest(5_000_000n, false);
    const h = t.health() as Record<string, unknown>;
    assert.ok(h.status === 'ok' || h.status === 'degraded');
    assert.equal(typeof h.uptime, 'number');
    assert.equal(h.pid, process.pid);
    const requests = h.requests as { total: number; errors: number };
    assert.equal(requests.total, 1);
    assert.equal(requests.errors, 0);
    assert.match(String(h.timestamp), /\d{4}-\d{2}-\d{2}T/);
  } finally {
    t.destroy();
  }
});

test('latency ring buffer is bounded and evicts oldest', () => {
  const t = tracker();
  try {
    // Push more than MAX_LATENCY_SAMPLES (10_000) — should not grow unbounded
    // and should still produce a valid percentile.
    for (let i = 0; i < 10_050; i++) t.recordRequest(1_000_000n, false);
    const s = t.snapshot();
    assert.equal(s.requestCount, 10_050);
    assert.equal(s.latencyP50, 1); // all 1 ms
  } finally {
    t.destroy();
  }
});

test('destroy stops the collector (safe to call)', () => {
  const t = new TelemetryTracker(1);
  assert.doesNotThrow(() => t.destroy());
});

test('DI token is a stable global symbol', () => {
  assert.equal(TELEMETRY_TRACKER, Symbol.for('@streetjs/telemetry:Tracker'));
});
