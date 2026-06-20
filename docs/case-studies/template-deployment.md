---
layout: default
title: "Template — Production Deployment Report"
parent: Case Studies
nav_order: 2
description: "Template for a StreetJS production deployment report."
sitemap:     false
noindex:     true
---

# Production Deployment Report — <project / org>

> Fill every field. Numbers must follow the verification standard (reproduction,
> raw data, environment).

## Deployment profile
- **StreetJS version:**
- **Platform:** (Cloud Run / ECS / Vercel / Cloudflare / k8s / VM)
- **Topology:** instances, regions, database, cache, queue
- **Go-live date / time in production:**

## Traffic
- Requests/sec (avg & peak):
- Concurrent connections (incl. WebSocket, if any):
- Data volume:

## Reliability
- Uptime over the reporting window (with the measurement source):
- Incident count & summary (no sensitive detail):

## Latency (raw, with percentiles)
| Endpoint/op | p50 | p95 | p99 | method/source |
|-------------|-----|-----|-----|---------------|

## Cost
- Infra cost for the workload (with the basis of measurement):

## Environment
- Instance type(s), Node version, DB version, config notes:

## Lessons
What you'd tell the next team deploying StreetJS at this scale.
