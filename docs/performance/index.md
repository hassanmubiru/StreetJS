---
layout:       default
title:        "Performance"
nav_order:    8
has_children: true
permalink:    /performance/
description:   "StreetJS Framework benchmarks — throughput, latency, startup and memory versus Fastify, Hono, Express and NestJS. All numbers produced by execution."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Benchmarks</span>
<h1>Performance</h1>
<p>Every number on this page was produced by execution — no estimates. Measured with a <code>node:http</code> loopback client at concurrency 50, 3 runs averaged, on Node v20.20.1.</p>
</div>

## At a glance

<div class="st-metrics">
  <div class="st-metric is-accent"><span class="m-val">27.5<span class="m-u">k</span></span><span class="m-lbl">Requests / sec</span><span class="m-sub">median, Run 2</span></div>
  <div class="st-metric"><span class="m-val">2<span class="m-u">ms</span></span><span class="m-lbl">P50 latency</span><span class="m-sub">P99 = 5ms</span></div>
  <div class="st-metric"><span class="m-val">70<span class="m-u">ms</span></span><span class="m-lbl">Cold startup</span><span class="m-sub">to first request</span></div>
  <div class="st-metric"><span class="m-val">2</span><span class="m-lbl">Runtime deps</span><span class="m-sub">reflect-metadata, ws</span></div>
</div>

{% include callout.html type="note" title="How to read this" body="StreetJS trades a little raw throughput for a fully in-house, memory-bounded stack (native PostgreSQL driver, JWT, sessions, WebSockets — no Express, no pg). It runs **~2.1× Express** and **~2.3× NestJS** while keeping a 2-dependency footprint." %}

## Throughput — requests per second

<div class="st-chart">
  <p class="st-chart-title">GET / → {"status":"ok"} · median req/s · higher is better</p>
  <div class="st-bar-row"><span class="st-bar-name">Fastify</span><div class="st-bar-track"><div class="st-bar-fill" style="--w:98%"></div></div><span class="st-bar-val">33,183</span></div>
  <div class="st-bar-row"><span class="st-bar-name">Hono</span><div class="st-bar-track"><div class="st-bar-fill" style="--w:91%"></div></div><span class="st-bar-val">30,776</span></div>
  <div class="st-bar-row is-me"><span class="st-bar-name">StreetJS</span><div class="st-bar-track"><div class="st-bar-fill" style="--w:82%"></div></div><span class="st-bar-val">27,700</span></div>
  <div class="st-bar-row"><span class="st-bar-name">Express</span><div class="st-bar-track"><div class="st-bar-fill" style="--w:39%"></div></div><span class="st-bar-val">13,017</span></div>
  <div class="st-bar-row"><span class="st-bar-name">NestJS</span><div class="st-bar-track"><div class="st-bar-fill" style="--w:35%"></div></div><span class="st-bar-val">11,783</span></div>
</div>

## Tail latency — P99 (ms)

<div class="st-chart">
  <p class="st-chart-title">99th-percentile response time · lower is better</p>
  <div class="st-bar-row"><span class="st-bar-name">Fastify</span><div class="st-bar-track"><div class="st-bar-fill" style="--w:38%"></div></div><span class="st-bar-val">3 ms</span></div>
  <div class="st-bar-row"><span class="st-bar-name">Hono</span><div class="st-bar-track"><div class="st-bar-fill" style="--w:38%"></div></div><span class="st-bar-val">3 ms</span></div>
  <div class="st-bar-row is-me"><span class="st-bar-name">StreetJS</span><div class="st-bar-track"><div class="st-bar-fill" style="--w:63%"></div></div><span class="st-bar-val">5 ms</span></div>
  <div class="st-bar-row"><span class="st-bar-name">Express</span><div class="st-bar-track"><div class="st-bar-fill" style="--w:100%"></div></div><span class="st-bar-val">8 ms</span></div>
  <div class="st-bar-row"><span class="st-bar-name">NestJS</span><div class="st-bar-track"><div class="st-bar-fill" style="--w:88%"></div></div><span class="st-bar-val">7 ms</span></div>
</div>

## Methodology

{% include callout.html type="tip" title="Reproduce it yourself" body="Results are written to `benchmarks/results.json`, `results.md` and `history.json`. The competitor packages live in an isolated `benchmarks/compare/` workspace so the framework keeps its 2-dependency footprint." %}

```bash
# one-time isolated comparison environment
cd benchmarks/compare && npm install --no-workspaces && cd -

# build + run the comparison
npm run build -w packages/core
node packages/core/dist/src/benchmarks/run.js --compare
```

- **Route** — `GET /` → `{"status":"ok"}`, identical payload on every framework.
- **Load** — `node:http` loopback client · concurrency 50 · 3000 ms window · 1000 ms warmup discarded.
- **Iterations** — 3 measured runs per framework (mean / median / best / worst / variance).
- **Environment** — single host, Node `v20.20.1`, servers started and stopped sequentially.
- **Competitors** — Express 5, Fastify 5, NestJS 11, Hono 4.

## Full report

<div class="st-cards">
  <a class="st-card" href="https://github.com/hassanmubiru/StreetJS/blob/main/docs/PERFORMANCE-CERTIFICATION.md">
    <p class="st-card-t">Performance Certification</p>
    <p class="st-card-d">Run-by-run tables, reproducibility data and variance analysis.</p>
  </a>
  <a class="st-card" href="https://github.com/hassanmubiru/StreetJS/blob/main/benchmarks/results.md">
    <p class="st-card-t">Raw results (results.md)</p>
    <p class="st-card-d">The generated artifact, straight from the benchmark runner.</p>
  </a>
</div>
