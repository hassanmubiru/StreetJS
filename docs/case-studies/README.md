---
layout: default
title: Case Studies
nav_order: 50
description: "How StreetJS collects production proof: verification standard and templates for migration, deployment, and benchmark reports."
---

# Case Studies & Production Proof

This program collects **verifiable** production evidence. The goal is to replace
unverifiable testimonials with reproducible reports.

## Verification standard (required for every claim)

Any quantitative claim (latency, throughput, uptime, cost, migration effort)
**must** include:

1. **Reproduction steps** — exact commands or a linked script.
2. **Raw numbers** — not just summaries; include percentiles for latency.
3. **Environment** — hardware/instance type, Node version, StreetJS version,
   dataset size, concurrency, and the date.

Claims that cannot be reproduced are not published. Marketing adjectives
("blazing", "the fastest") are not accepted — numbers and methodology only.

## Templates

- [Migration Case Study](template-migration.md) — moving from another framework.
- [Production Deployment Report](template-deployment.md) — running it in production.
- [Benchmark Report](template-benchmark.md) — performance measurement.

## Submitting

Open a PR adding a filled-in template under `docs/case-studies/`. A maintainer
checks it against the verification standard before merge. Vendor/self benchmarks
must open-source the harness so others can re-run them — the repo's
`scripts/benchmark-reference-apps.mjs` is the reference for methodology rigor.
