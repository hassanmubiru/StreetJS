---
layout:      default
title:       "Runtime Benchmarks (reproducible)"
permalink:   /benchmarks/runtime/
nav_exclude: true
description:  "Honest, reproducible StreetJS runtime micro-benchmarks — cold start, hello-world HTTP throughput, and in-memory pillar hot paths. Scripts, hardware, and method are published so you can reproduce (and disprove) every number."
---

# Runtime Benchmarks

These are **honest, reproducible** micro-benchmarks. Every number here comes from
a committed script you can run yourself; the hardware and method are stated. We
publish the method over the magnitude — absolute numbers are environment
dependent, and these are meant to (a) catch regressions and (b) characterize
relative cost, not to win a leaderboard.

**What we deliberately do NOT do:** quote a peak RPS from a tuned load test as if
it were typical, cherry-pick a favorable run, or compare against other frameworks
without publishing identical method + hardware (and the losing runs). If you want
a headline RPS number, run a dedicated load generator (autocannon/wrk/k6) against
a deployed instance — the HTTP figures below are a conservative **floor** from an
in-process probe, not a peak.

## How to reproduce

```bash
# 1) In-memory pillar hot paths (gateway, events, realtime) — ops/sec + ns/op
node scripts/bench-pillars.mjs

# 2) Core HTTP: cold start + hello-world throughput floor
npm run build -w packages/core && node scripts/bench-http.mjs
#    tune the workload: BENCH_REQUESTS=50000 BENCH_CONCURRENCY=100 node scripts/bench-http.mjs
```

## Environment for the numbers below

| | |
|---|---|
| CPU | 12th Gen Intel Core i7-1255U (12 logical cores) |
| Memory | 16.4 GB |
| Runtime | Node.js v20.20.1 |
| OS | Linux 6.17 |
| Workload (HTTP) | 20,000 requests @ concurrency 50, in-process loopback |

> Note: the published CI matrix runs Node 22/24; these local figures are on Node
> 20. Re-run on your target runtime — numbers move with the Node version.

## Core HTTP (`scripts/bench-http.mjs`)

| Metric | Result | Notes |
|---|---:|---|
| Cold start (`streetApp()` → listening, avg of 5) | ~1 ms | process already warm |
| Plain-text throughput | ~25,000 req/sec | **floor**, in-process probe |
| JSON throughput | ~27,000 req/sec | **floor**, in-process probe |

Cold start is sub-millisecond because the core has no heavy framework
bootstrap — `streetApp()` wires an `http.Server` and a router and listens. The
throughput figures are a floor: the load client shares the CPU with the server in
the same process, so a real deployment behind a dedicated generator will measure
higher.

## In-memory pillar hot paths (`scripts/bench-pillars.mjs`)

CPU/allocation-bound public-API paths, no external services:

| Path | ops/sec | ns/op |
|---|---:|---:|
| gateway `resolveVersion` (path hit) | ~8,800,000 | ~113 |
| events publish → 1 listener | ~547,000 | ~1,826 |
| events publish → 10 listeners | ~390,000 | ~2,562 |
| events publish → 100 listeners | ~77,000 | ~12,920 |
| realtime broadcast → 10 connections | ~1,180,000 | ~843 |
| realtime broadcast → 100 connections | ~1,120,000 | ~892 |

Event fan-out cost scales with listener count (as expected); realtime broadcast
stays roughly flat from 10→100 connections.

## Dependency footprint

Runtime speed is only one axis. StreetJS's headline characteristic is a small,
curated dependency tree — see the separate [dependency footprint benchmark](../footprint/)
(`scripts/benchmark-footprint.mjs`) for the resolved-dependency comparison.

---

*Numbers last measured 2026-07-12 on the environment above. Re-run the scripts to
reproduce; open an issue if your figures differ materially so we can investigate
(a real regression) or refine the method.*
