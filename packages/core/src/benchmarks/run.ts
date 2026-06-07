// packages/core/src/benchmarks/run.ts
// Entry point for benchmark suite

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { streetApp } from '../http/server.js';
import { runHttpBenchmark, measureStreetStartup, type BenchmarkResult } from './http-benchmark.js';

const BENCHMARK_PORT = 19876;
const DURATION_MS = 3000;

async function runStreetBenchmark(): Promise<BenchmarkResult> {
  const app = streetApp({ port: BENCHMARK_PORT });
  app.use(async (ctx) => {
    if (ctx.path === '/bench') {
      ctx.json({ message: 'hello world', ts: Date.now() });
    }
  });
  await app.listen(BENCHMARK_PORT);

  const result = await runHttpBenchmark('Street', BENCHMARK_PORT, DURATION_MS, 10);
  result.startupMs = await measureStreetStartup();

  await app.close();
  return result;
}

async function main(): Promise<void> {
  const compareMode = process.argv.includes('--compare');
  if (compareMode) {
    await runComparison();
    return;
  }

  console.log('\n🏎  Street Framework HTTP Benchmark\n');
  console.log(`Duration: ${DURATION_MS}ms | Concurrency: 10`);
  console.log('─'.repeat(60));

  const results: BenchmarkResult[] = [];

  // Street benchmark
  process.stdout.write('Running Street benchmark... ');
  const streetResult = await runStreetBenchmark();
  results.push(streetResult);
  process.stdout.write(`done — ${streetResult.requestsPerSec} req/s\n`);

  // Print results table
  console.log('\n📊 Results:\n');
  console.log(`${'Framework'.padEnd(12)} ${'req/s'.padStart(8)} ${'P50ms'.padStart(7)} ${'P95ms'.padStart(7)} ${'P99ms'.padStart(7)} ${'Mem MB'.padStart(8)}`);
  console.log('─'.repeat(60));

  for (const r of results) {
    console.log(
      `${r.name.padEnd(12)} ${String(r.requestsPerSec).padStart(8)} ${String(r.latencyP50Ms).padStart(7)} ${String(r.latencyP95Ms).padStart(7)} ${String(r.latencyP99Ms).padStart(7)} ${String(r.memoryMb).padStart(8)}`
    );
  }

  // Check for baseline regression
  const baselineFlag = process.argv.indexOf('--baseline');
  if (baselineFlag !== -1) {
    const baselineFile = process.argv[baselineFlag + 1];
    if (baselineFile && existsSync(baselineFile)) {
      const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as Record<string, number>;
      const currentRps = streetResult.requestsPerSec;
      const baselineRps = baseline['street_rps'] ?? currentRps;
      const degradation = (baselineRps - currentRps) / baselineRps;

      if (degradation > 0.10) {
        console.error(`\n❌ Performance regression: ${(degradation * 100).toFixed(1)}% below baseline (${baselineRps} req/s → ${currentRps} req/s)`);
        process.exit(1);
      } else {
        console.log(`\n✅ Performance within baseline (${(degradation * 100).toFixed(1)}% delta)`);
      }
    } else {
      // Write new baseline
      const newBaseline = { street_rps: streetResult.requestsPerSec };
      if (baselineFile) writeFileSync(baselineFile, JSON.stringify(newBaseline, null, 2));
      console.log(`\n📝 Wrote baseline: ${streetResult.requestsPerSec} req/s`);
    }
  }

  console.log('\nNote: Express/Fastify/NestJS/Hono/Fiber/Gin comparisons require those frameworks');
  console.log('to be installed. Run: npm install -g autocannon express fastify');
  console.log('Then run: node dist/benchmarks/run.js --compare');

  // ── Reproducible report artifacts ──────────────────────────────────────────
  const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
      transport: 'node:http loopback client',
      durationMs: DURATION_MS,
      concurrency: 10,
      route: 'GET /bench → JSON',
      node: process.version,
    },
    results,
  };
  writeFileSync('benchmark-report.json', JSON.stringify(report, null, 2));

  const md = [
    '# Benchmark Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Node: ${process.version} | Duration: ${DURATION_MS}ms | Concurrency: 10`,
    '',
    '| Framework | req/s | P50ms | P95ms | P99ms | Mem MB | Startup ms |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.name} | ${r.requestsPerSec} | ${r.latencyP50Ms} | ${r.latencyP95Ms} | ${r.latencyP99Ms} | ${r.memoryMb} | ${r.startupMs} |`),
    '',
    '## Methodology',
    '',
    'Each framework serves a single JSON route (`GET /bench`). A `node:http` client',
    'drives the configured concurrency for the duration and records per-request',
    'latency; percentiles are computed from the sorted sample. Runs are reproducible',
    'via `node dist/src/benchmarks/run.js`. Competitor comparisons run with',
    '`--compare` once Express/Fastify/NestJS/Hono are installed.',
    '',
  ].join('\n');
  writeFileSync('benchmark-report.md', md);

  // Append to history for trend tracking.
  let history: unknown[] = [];
  if (existsSync('benchmark-history.json')) {
    try { history = JSON.parse(readFileSync('benchmark-history.json', 'utf8')) as unknown[]; } catch { history = []; }
  }
  history.push({ at: report.generatedAt, street_rps: streetResult.requestsPerSec, p99: streetResult.latencyP99Ms, memMb: streetResult.memoryMb });
  writeFileSync('benchmark-history.json', JSON.stringify(history, null, 2));
  console.log('\n📄 Wrote benchmark-report.json, benchmark-report.md, benchmark-history.json');
}

function stats(values: number[]): { mean: number; median: number; variance: number; best: number; worst: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return {
    mean: Math.round(mean),
    median,
    variance: Math.round(variance),
    best: sorted[sorted.length - 1] ?? 0, // best = highest req/s
    worst: sorted[0] ?? 0,
  };
}

async function runComparison(): Promise<void> {
  const ITERATIONS = 3;
  const DURATION = 3000;
  const CONCURRENCY = 50;
  const WARMUP_MS = 1000;
  const BASE_PORT = 21000;

  const here = dirname(fileURLToPath(import.meta.url));
  const serversPath = join(here, '..', '..', '..', '..', '..', 'benchmarks', 'compare', 'servers.mjs');
  const repoRoot = join(here, '..', '..', '..', '..', '..');
  const outDir = join(repoRoot, 'benchmarks');

  console.log('\n🏁  Street Framework — Comparative Benchmark (--compare)\n');
  if (!existsSync(serversPath)) {
    console.error(`Comparison harness not found at ${serversPath}.`);
    console.error('Set up the isolated env: (cd benchmarks/compare && npm install) then re-run.');
    process.exit(1);
  }
  const { FACTORIES } = await import(serversPath) as { FACTORIES: Record<string, (port: number) => Promise<{ name: string; port: number; close: () => unknown }>> };

  console.log(`Node: ${process.version} | iterations: ${ITERATIONS} | duration: ${DURATION}ms | concurrency: ${CONCURRENCY} | warmup: ${WARMUP_MS}ms`);
  console.log('Route: GET / → {"status":"ok"}\n');
  console.log('─'.repeat(78));

  const frameworks = Object.keys(FACTORIES);
  const summary: Array<Record<string, unknown>> = [];
  const raw: Array<Record<string, unknown>> = [];
  let port = BASE_PORT;

  for (const fw of frameworks) {
    const rpsRuns: number[] = [];
    const p50Runs: number[] = [];
    const p95Runs: number[] = [];
    const p99Runs: number[] = [];
    let startupMs = 0;
    let memoryMb = 0;

    for (let i = 0; i < ITERATIONS; i++) {
      port += 1;
      const memBefore = process.memoryUsage().rss;
      const startupStart = Date.now();
      const handle = await FACTORIES[fw]!(port);
      if (i === 0) startupMs = Date.now() - startupStart;
      // warmup
      await runHttpBenchmark(`${fw}-warmup`, port, WARMUP_MS, CONCURRENCY, '/');
      const res = await runHttpBenchmark(fw, port, DURATION, CONCURRENCY, '/');
      const memAfter = process.memoryUsage().rss;
      if (i === 0) memoryMb = Math.round(((memAfter - memBefore) / 1024 / 1024) * 100) / 100;
      rpsRuns.push(res.requestsPerSec);
      p50Runs.push(res.latencyP50Ms);
      p95Runs.push(res.latencyP95Ms);
      p99Runs.push(res.latencyP99Ms);
      await handle.close();
      raw.push({ framework: fw, iteration: i + 1, ...res });
      // brief settle between servers
      await new Promise((r) => setTimeout(r, 250));
    }

    const s = stats(rpsRuns);
    const row = {
      framework: fw,
      rps_mean: s.mean,
      rps_median: s.median,
      rps_best: s.best,
      rps_worst: s.worst,
      rps_variance: s.variance,
      p50_median: p50Runs.sort((a, b) => a - b)[Math.floor(p50Runs.length / 2)] ?? 0,
      p95_median: p95Runs.sort((a, b) => a - b)[Math.floor(p95Runs.length / 2)] ?? 0,
      p99_median: p99Runs.sort((a, b) => a - b)[Math.floor(p99Runs.length / 2)] ?? 0,
      startupMs,
      memoryMb,
    };
    summary.push(row);
    console.log(`${fw.padEnd(10)} req/s mean=${String(s.mean).padStart(7)} median=${String(s.median).padStart(7)} best=${String(s.best).padStart(7)} worst=${String(s.worst).padStart(7)} | startup=${startupMs}ms mem=${memoryMb}MB`);
  }

  mkdirSync(outDir, { recursive: true });
  const report = {
    generatedAt: new Date().toISOString(),
    methodology: {
      route: 'GET / → {"status":"ok"}',
      iterations: ITERATIONS, durationMsPerRun: DURATION, concurrency: CONCURRENCY, warmupMs: WARMUP_MS,
      transport: 'node:http loopback client', node: process.version, sameProcessSequential: true,
    },
    frameworks: summary,
    raw,
  };
  writeFileSync(join(outDir, 'results.json'), JSON.stringify(report, null, 2));

  const md = [
    '# Comparative Benchmark Results',
    '',
    `Generated: ${report.generatedAt}`,
    `Node: ${process.version} | iterations: ${ITERATIONS} | ${DURATION}ms/run | concurrency ${CONCURRENCY} | warmup ${WARMUP_MS}ms`,
    'Route: `GET /` → `{"status":"ok"}`',
    '',
    '| Framework | req/s (mean) | req/s (median) | best | worst | P50ms | P95ms | P99ms | startup ms | mem MB |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...summary.map((r) => `| ${r['framework']} | ${r['rps_mean']} | ${r['rps_median']} | ${r['rps_best']} | ${r['rps_worst']} | ${r['p50_median']} | ${r['p95_median']} | ${r['p99_median']} | ${r['startupMs']} | ${r['memoryMb']} |`),
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'results.md'), md);

  let history: unknown[] = [];
  const histPath = join(outDir, 'history.json');
  if (existsSync(histPath)) { try { history = JSON.parse(readFileSync(histPath, 'utf8')) as unknown[]; } catch { history = []; } }
  history.push({ at: report.generatedAt, node: process.version, frameworks: summary.map((r) => ({ framework: r['framework'], rps_median: r['rps_median'] })) });
  writeFileSync(histPath, JSON.stringify(history, null, 2));

  console.log(`\n📄 Wrote benchmarks/results.json, benchmarks/results.md, benchmarks/history.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });