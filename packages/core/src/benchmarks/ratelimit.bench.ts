// packages/core/src/benchmarks/ratelimit.bench.ts
// Reproducible rate-limit benchmark harness (R3.9).
//
// Measures the throughput (requests/second) and per-request overhead
// (nanoseconds) of the sliding-window rate limiter against the default
// `InMemoryRateLimitStore`. Each simulated request reproduces exactly the work
// the `rateLimit` middleware performs per call: a `count()` peek followed by a
// `hit()` record. Window timing is driven by an injected, deterministic clock
// that advances a fixed step per request, so results are reproducible across
// runs and machines (modulo raw CPU speed) and the sliding-window prune path is
// exercised realistically.
//
// Running (after `npm run build`):
//   node dist/benchmarks/ratelimit.bench.js
// Emits `ratelimit-benchmark.json` (machine-readable metrics for evidence
// capture) and prints a human-readable table.

import { writeFileSync } from 'node:fs';
import { InMemoryRateLimitStore, type Clock } from '../security/store.js';

/** A single benchmark scenario definition. */
export interface RateLimitBenchScenario {
  /** Human-readable scenario name. */
  name: string;
  /** Number of distinct keys (e.g. distinct client IPs/users) cycled through. */
  keys: number;
  /** Sliding window size in milliseconds. */
  windowMs: number;
  /** Total simulated requests to execute. */
  iterations: number;
  /** Simulated time (ms) elapsed between consecutive requests. */
  stepMs: number;
}

/** Metrics produced for a single scenario. */
export interface RateLimitBenchResult {
  scenario: string;
  keys: number;
  windowMs: number;
  iterations: number;
  /** Wall-clock time spent in the measured loop, milliseconds. */
  totalMs: number;
  /** Throughput: measured requests per second. */
  requestsPerSec: number;
  /** Per-request overhead in nanoseconds (mean). */
  nsPerRequest: number;
}

/** The full benchmark report written to disk for evidence capture. */
export interface RateLimitBenchReport {
  generatedAt: string;
  methodology: {
    store: 'InMemoryRateLimitStore';
    perRequestOps: 'count + hit';
    clock: 'deterministic, fixed-step';
    node: string;
    warmupIterations: number;
  };
  results: RateLimitBenchResult[];
}

/** Default scenarios covering small, medium, and large key cardinalities. */
export const DEFAULT_SCENARIOS: readonly RateLimitBenchScenario[] = [
  { name: 'single-key (global)', keys: 1, windowMs: 60_000, iterations: 200_000, stepMs: 0 },
  { name: 'per-ip (1k keys)', keys: 1_000, windowMs: 60_000, iterations: 200_000, stepMs: 1 },
  { name: 'per-user (50k keys)', keys: 50_000, windowMs: 60_000, iterations: 200_000, stepMs: 1 },
];

/** Build a deterministic clock that advances `stepMs` each time it is read. */
function makeSteppingClock(startMs: number, stepMs: number): Clock {
  let nowMs = startMs;
  return () => {
    const t = nowMs;
    nowMs += stepMs;
    return t;
  };
}

/**
 * Execute one scenario against a fresh {@link InMemoryRateLimitStore} and return
 * its throughput and per-request overhead. Each iteration performs the same two
 * store operations the `rateLimit` middleware performs per request: a `count()`
 * peek followed by a `hit()` record.
 */
export async function runRateLimitScenario(
  scenario: RateLimitBenchScenario,
  warmupIterations = 10_000,
): Promise<RateLimitBenchResult> {
  const { keys, windowMs, iterations, stepMs } = scenario;

  // Warmup: prime the store and JIT without timing.
  {
    const warmClock = makeSteppingClock(0, stepMs);
    const warmStore = new InMemoryRateLimitStore({ clock: warmClock, maxKeys: keys + 1 });
    for (let i = 0; i < warmupIterations; i++) {
      const key = `k${i % keys}`;
      const now = warmClock();
      await warmStore.count(key, now, windowMs);
      await warmStore.hit(key, now, windowMs);
    }
    warmStore.destroy();
  }

  const clock = makeSteppingClock(0, stepMs);
  // Allow all distinct keys to be retained so eviction is not measured.
  const store = new InMemoryRateLimitStore({ clock, maxKeys: keys + 1 });

  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) {
    const key = `k${i % keys}`;
    const now = clock();
    await store.count(key, now, windowMs);
    await store.hit(key, now, windowMs);
  }
  const elapsedNs = process.hrtime.bigint() - start;
  store.destroy();

  const totalMs = Number(elapsedNs) / 1e6;
  const seconds = totalMs / 1000;
  const requestsPerSec = seconds > 0 ? Math.round(iterations / seconds) : 0;
  const nsPerRequest = Math.round(Number(elapsedNs) / iterations);

  return {
    scenario: scenario.name,
    keys,
    windowMs,
    iterations,
    totalMs: Math.round(totalMs * 100) / 100,
    requestsPerSec,
    nsPerRequest,
  };
}

/** Run every scenario and assemble the full report. */
export async function runRateLimitBenchmark(
  scenarios: readonly RateLimitBenchScenario[] = DEFAULT_SCENARIOS,
  warmupIterations = 10_000,
): Promise<RateLimitBenchReport> {
  const results: RateLimitBenchResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runRateLimitScenario(scenario, warmupIterations));
  }
  return {
    generatedAt: new Date().toISOString(),
    methodology: {
      store: 'InMemoryRateLimitStore',
      perRequestOps: 'count + hit',
      clock: 'deterministic, fixed-step',
      node: process.version,
      warmupIterations,
    },
    results,
  };
}

async function main(): Promise<void> {
  console.log('\n⏱  Street Framework — Rate-Limit Benchmark (InMemoryRateLimitStore)\n');
  console.log(`Node: ${process.version}`);
  console.log('Per request: count() + hit() (matches rateLimit middleware)');
  console.log('─'.repeat(72));

  const report = await runRateLimitBenchmark();

  console.log(
    `\n${'Scenario'.padEnd(22)} ${'keys'.padStart(7)} ${'req/s'.padStart(10)} ${'ns/req'.padStart(9)} ${'totalMs'.padStart(9)}`,
  );
  console.log('─'.repeat(72));
  for (const r of report.results) {
    console.log(
      `${r.scenario.padEnd(22)} ${String(r.keys).padStart(7)} ${String(r.requestsPerSec).padStart(10)} ${String(r.nsPerRequest).padStart(9)} ${String(r.totalMs).padStart(9)}`,
    );
  }

  const outFile = 'ratelimit-benchmark.json';
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`\n📄 Wrote ${outFile}`);
}

// Run as a script when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
