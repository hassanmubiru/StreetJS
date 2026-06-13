# Comparative Benchmark Results

Generated: 2026-06-07T04:47:13.913Z
Node: v20.20.1 | iterations: 3 | 3000ms/run | concurrency 50 | warmup 1000ms
Route: `GET /` → `{"status":"ok"}`

| Framework | req/s (mean) | req/s (median) | best | worst | P50ms | P95ms | P99ms | startup ms | mem MB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| StreetJS | 27537 | 27700 | 28193 | 26717 | 2 | 3 | 5 | 70 | 64.11 |
| Express | 13034 | 13017 | 13217 | 12867 | 4 | 6 | 8 | 41 | 5.27 |
| Fastify | 33460 | 33183 | 34286 | 32912 | 1 | 2 | 3 | 54 | 6.43 |
| NestJS | 11741 | 11783 | 11787 | 11652 | 4 | 6 | 7 | 109 | 11.02 |
| Hono | 30410 | 30776 | 32019 | 28435 | 2 | 2 | 3 | 17 | 10.15 |
