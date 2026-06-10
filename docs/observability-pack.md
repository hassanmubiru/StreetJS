---
layout: default
title: "Observability Pack — Dashboards, Alerts & SLOs"
nav_exclude: true
description: "StreetJS observability pack — Grafana dashboards, Prometheus alerts and an SLO pack built only on metrics the framework truly exports, validated with promtool."
---

# Observability Pack

Street ships an **observability pack**: Grafana dashboards, Prometheus alert
rules, and an SLO pack, all built **only on metrics the framework actually
exports** at runtime. An anti-fabrication guard plus a promtool-backed
validation pipeline keep that guarantee enforceable, so your observability
reflects real signals and never fabricated ones.

Emit the pack to disk at any time:

```bash
node scripts/observability/emit-assets.mjs
# observability/prometheus/street-rules.yml
# observability/grafana/dashboards/*.json
```

## Dashboards

One dashboard per subsystem, each panel targeting an Exported Metric:

| Dashboard | UID | Covers |
|---|---|---|
| HTTP API | `street-api` | request rate, 5xx error ratio, p95/p99 latency |
| Runtime | `street-runtime` | process heap, throughput, error ratio, p99 latency |
| PostgreSQL | `street-postgres` | pool connections by state, pool exhaustion, query p95, acquire p95 |
| Kafka | `street-kafka` | produced/consumed throughput, consumer lag, coordinator wait p95 |
| RabbitMQ | `street-rabbitmq` | publish/deliver throughput, queue depth, consumer count |
| Plugin Host | `street-plugin-host` | plugins by state, signature failure rate, install duration p95 |

Import the JSON directly into Grafana or provision it from
`observability/grafana/dashboards/`.

## Alerts

Operational alerts, each with a **numeric trigger threshold** and an
**evaluation window**, covering the four required signal classes:

| Signal class | Example alert | Threshold / window |
|---|---|---|
| latency | `StreetDbQueryLatencyHigh` | query p99 > 0.5s for 10m |
| error rate | `StreetPluginSignatureFailureRate` | any signature failure over 5m |
| queue depth | `StreetRabbitMqQueueDepthHigh` | ready messages > 1000 for 5m |
| memory pressure | `StreetMemoryPressureHigh` | heap > 768MiB for 10m |

The HTTP alert group (`StreetHighErrorRate`, `StreetHighLatencyP99`,
`StreetTargetDown`) and the saturation alert (`StreetHighHeapUsage`) ship
alongside them.

## SLO Pack

The SLO pack defines three objectives, each with a **numeric target** and a
**measurement window** (default `30d`):

| Objective | Target | Window |
|---|---|---|
| availability | 99.9% | 30d |
| latency | p99 ≤ 0.5s | 30d |
| error budget | 0.1% | 30d |

The error-budget objective is enforced with multi-window, multi-burn-rate
alerts (`StreetErrorBudgetBurnFast` / `StreetErrorBudgetBurnSlow`) extending
`streetSloBurnRateRules`. Availability and latency breaches raise
`StreetAvailabilitySloBreach` / `StreetLatencySloBreach`.

## Validation pipeline

Before the assets are trusted they pass a four-stage validation pipeline. The
first three stages run fully offline; the fourth uses Prometheus' own
`promtool`:

1. **`validateMetricReferences`** — the anti-fabrication guard. Every metric a
   dashboard panel or rule expression references must be an Exported Metric. If
   an asset references a metric the application does not export, validation
   **fails and records the offending `(metric, asset)` pair**.
2. **`validatePrometheusRuleGroups`** — rule-group structure and semantics
   (unique group names, exactly one of `record`/`alert` per rule, non-empty
   expressions, severity labels, summary annotations, valid durations).
3. **`validateGrafanaDashboard`** — per-dashboard structure (uid, title, schema
   version, panels, and per-target `expr`/`refId`).
4. **promtool** — `promtool check rules` (semantic validity) and
   `promtool test rules` (alert-behaviour unit tests) over the emitted rule
   files.

If promtool or dashboard validation reports an error, validation **fails and
records the validation error** (Req 10.8).

The "Exported Metric" authority is the union of: the default HTTP/process
metrics, the PostgreSQL/Kafka/RabbitMQ/Plugin Host subsystem metrics, the
recording-rule outputs (the `record:` series alerts and dashboards consume), and
the Prometheus built-in `up` series.

### Running the pipeline

```bash
# Offline + promtool (when installed), standalone:
node scripts/observability/validate.mjs

# Through the verification runner (emits the Verification Artifact):
npm run verify:observability
```

The verification driver runs the pipeline through the zero-dependency
`CommandRunner` and emits a machine-readable Verification Artifact recording the
executed command, the command exit code, and an ISO-8601 timestamp (Req 10.9):

```
verification-artifacts/observability/observability.validate.artifact.json
```

**Honest BLOCKED:** when `promtool` is not installed, the offline validators
still run and are recorded, and the artifact is marked `BLOCKED` with the
specific missing prerequisite (`promtool`) — never a mock and never a false
`VERIFIED`. GitHub-hosted runners install promtool in the `observability`
workflow, so CI runs the full semantic validation and earns `VERIFIED`.
