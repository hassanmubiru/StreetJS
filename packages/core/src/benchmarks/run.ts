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

main().catch((e) => { console.error(e); process.exit(1); });