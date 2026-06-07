# Comparative Benchmark Results

Generated: 2026-06-07T04:45:43.639Z
Node: v20.20.1 | iterations: 3 | 3000ms/run | concurrency 50 | warmup 1000ms
Route: `GET /` → `{"status":"ok"}`

| Framework | req/s (mean) | req/s (median) | best | worst | P50ms | P95ms | P99ms | startup ms | mem MB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Street | 29111 | 28933 | 29753 | 28646 | 2 | 3 | 4 | 70 | 53.67 |
| Express | 13344 | 13362 | 13469 | 13200 | 3 | 6 | 7 | 47 | 17.83 |
| Fastify | 33762 | 33883 | 33924 | 33478 | 1 | 2 | 3 | 102 | 6.14 |
| NestJS | 11639 | 11833 | 11933 | 11150 | 4 | 6 | 7 | 157 | 2.34 |
| Hono | 31945 | 32256 | 33062 | 30517 | 2 | 2 | 3 | 21 | 7.64 |
