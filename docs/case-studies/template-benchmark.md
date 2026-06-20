---
layout: default
title: "Template — Benchmark Report"
parent: Case Studies
nav_order: 3
description: "Template for a reproducible StreetJS benchmark report."
sitemap:     false
noindex:     true
---

# Benchmark Report — <scenario>

> A benchmark without a reproducible harness is not accepted. Link the harness.

## Methodology
- **What is measured:** (throughput / latency / memory / cold start)
- **Harness:** link to the script/repo (must be open and re-runnable)
- **Load generator & settings:** (tool, concurrency, duration, warmup)
- **What is NOT measured / caveats:**

## Hardware / environment
- CPU, memory, OS:
- Node version, StreetJS version:
- Database/cache versions (if in scope):
- Network (same-host / LAN / cloud region):

## Workloads
Describe each workload (payload size, route shape, DB involvement).

## Results (raw)
| Workload | Throughput (req/s) | p50 | p95 | p99 | memory |
|----------|--------------------|-----|-----|-----|--------|

Attach the raw output (or link it). Include run-to-run variance.

## Comparison (optional)
If comparing to another framework, run **both** with the same harness and publish
both configs. State versions and any tuning applied to each.

## Reproduction
```bash
# exact commands to reproduce
```
