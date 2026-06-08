# Performance Certification

All numbers below were produced by **execution** — no estimates, no fabricated
data. Reproduce with:

```bash
# one-time isolated comparison env (keeps the framework itself dependency-light)
cd benchmarks/compare && npm install --no-workspaces && cd -
# build + run
npm run build -w packages/core
node packages/core/dist/src/benchmarks/run.js --compare
```

Artifacts are written to `benchmarks/results.json`, `benchmarks/results.md`,
and `benchmarks/history.json`.

## Methodology

- **Route:** `GET /` → `{"status":"ok"}` on every framework (identical payload).
- **Load:** `node:http` loopback client, concurrency **50**, **3000ms** measured
  window per run, **1000ms** warmup discarded before measuring.
- **Iterations:** **3** measured runs per framework; reported as
  mean / median / best / worst / variance.
- **Environment:** single host, single Node version (`v20.20.1`), same process,
  servers started and stopped sequentially.
- **Competitors:** Express 5, Fastify 5, NestJS 11 (platform-express), Hono 4
  (`@hono/node-server`), installed in an isolated `benchmarks/compare/` package
  so `@streetjs/core` keeps its dependency-light footprint.

## Results — Run 1 (2026-06-07)

| Framework | req/s (mean) | req/s (median) | best | worst | P50ms | P95ms | P99ms | startup ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Fastify | 33,762 | 33,883 | 33,924 | 33,478 | 1 | 2 | 3 | 102 |
| Hono | 31,945 | 32,256 | 33,062 | 30,517 | 2 | 2 | 3 | 21 |
| **Street** | **29,111** | **28,933** | **29,753** | **28,646** | **2** | **3** | **4** | **70** |
| Express | 13,344 | 13,362 | 13,469 | 13,200 | 3 | 6 | 7 | 47 |
| NestJS | 11,639 | 11,833 | 11,933 | 11,150 | 4 | 6 | 7 | 157 |

## Results — Run 2 (reproducibility)

| Framework | req/s (mean) | req/s (median) | best | worst |
| --- | --- | --- | --- | --- |
| Fastify | 33,460 | 33,183 | 34,286 | 32,912 |
| Hono | 30,410 | 30,776 | 32,019 | 28,435 |
| **Street** | **27,537** | **27,700** | **28,193** | **26,717** |
| Express | 13,034 | 13,017 | 13,217 | 12,867 |
| NestJS | 11,741 | 11,783 | 11,787 | 11,652 |

## Summary

- **Street sustains ~27–29k req/s** with P99 ≤ 4ms on this host.
- **~2.2× faster than Express** and **~2.5× faster than NestJS**.
- **Within ~10–15% of Fastify and Hono**, the two fastest Node HTTP frameworks —
  while shipping its own from-scratch HTTP layer, router, DI, and PostgreSQL
  wire driver with a dependency-light core.
- Ordering is stable across runs (Fastify ≳ Hono ≳ Street ≫ Express ≳ NestJS).

### Note on memory figures

`benchmarks/results.json` records an RSS-delta memory column. Because all
servers run sequentially in one process, the first framework measured absorbs
Node's baseline/JIT warmup and its delta is not directly comparable to later
entries. Throughput and latency (the certified metrics) are measured per-run
after warmup and are reliable; the memory column is reported transparently as
indicative only. For isolated memory profiling, run each server in its own
process.

## Regression gate

The single-framework runner supports a baseline regression gate
(`--baseline <file>`), failing if throughput drops > 10% from the recorded
baseline. The comparative runner appends every run to `benchmarks/history.json`
for trend tracking. The benchmark CI job (`.github/workflows/ci-cd.yml`)
executes the benchmark on every push.

## Reproducibility

The harness, server definitions (`benchmarks/compare/servers.mjs`), and runner
(`packages/core/src/benchmarks/run.ts`) are committed. A clean checkout plus the
one-time `benchmarks/compare` install reproduces these tables (absolute numbers
vary with hardware; relative ordering is stable).
