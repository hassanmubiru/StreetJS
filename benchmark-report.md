# Benchmark Report

Generated: 2026-06-07T04:10:17.845Z
Node: v20.20.1 | Duration: 3000ms | Concurrency: 10

| Framework | req/s | P50ms | P95ms | P99ms | Mem MB | Startup ms |
| --- | --- | --- | --- | --- | --- | --- |
| Street | 22891 | 0 | 1 | 2 | 23.91 | 2 |

## Methodology

Each framework serves a single JSON route (`GET /bench`). A `node:http` client
drives the configured concurrency for the duration and records per-request
latency; percentiles are computed from the sorted sample. Runs are reproducible
via `node dist/src/benchmarks/run.js`. Competitor comparisons run with
`--compare` once Express/Fastify/NestJS/Hono are installed.
