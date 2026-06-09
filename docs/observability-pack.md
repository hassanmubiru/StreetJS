---
layout: default
title: "Observability Pack"
nav_exclude: true
---

# Observability Pack

Street ships a ready-to-use observability pack for its default HTTP metrics
(`http_requests_total`, `http_request_duration_seconds`): Prometheus recording
rules, operational alerts, multi-window SLO burn-rate alerts, and a Grafana
dashboard. Everything is generated from typed models with a built-in validator,
so the assets stay correct and reproducible. Dependency-free.

Exported from `streetjs`.

## Contents

| Asset | Builder | Validator | Status |
| --- | --- | --- | --- |
| Recording rules (rate, error ratio, p95/p99) | `streetRecordingRules()` | `validatePrometheusRuleGroups` | VERIFIED |
| Operational alerts (error rate, latency, target down) | `streetAlertRules()` | `validatePrometheusRuleGroups` | VERIFIED |
| SLO burn-rate alerts (99.9%, multi-window) | `streetSloBurnRateRules()` | `validatePrometheusRuleGroups` | VERIFIED |
| Grafana dashboard (4 panels) | `streetApiDashboard()` | `validateGrafanaDashboard` | VERIFIED |
| YAML serializer | `serializePrometheusRulesYaml()` | — | VERIFIED |

> `promtool test rules` (Prometheus' own semantic checker) runs in CI where the
> `promtool` binary is available; the in-repo validator covers structure and
> internal consistency offline.

## Emit the assets

```bash
node scripts/observability/emit-assets.mjs
# observability/prometheus/street-rules.yml   (3 groups, 9 rules)
# observability/grafana/dashboards/street-api.json (4 panels)
```

The script validates both before writing and exits non-zero on any error.

## Programmatic use

```ts
import {
  streetRuleGroups, validatePrometheusRuleGroups, serializePrometheusRulesYaml,
  streetApiDashboard, validateGrafanaDashboard,
} from 'streetjs';

const groups = streetRuleGroups();
if (!validatePrometheusRuleGroups(groups).valid) throw new Error('bad rules');
const yaml = serializePrometheusRulesYaml(groups); // load into Prometheus

const dashboard = streetApiDashboard();             // import into Grafana
validateGrafanaDashboard(dashboard).valid;          // true
```

## SLO model

The burn-rate alerts target a **99.9% availability** objective (0.1% error
budget) using the Google SRE multi-window approach:

- **Fast burn** (`StreetErrorBudgetBurnFast`, severity `critical`): 14.4x budget
  burn over **1h and 5m** windows → page.
- **Slow burn** (`StreetErrorBudgetBurnSlow`, severity `warning`): 6x budget burn
  over **6h and 30m** windows → ticket.

Both require the condition to hold on *both* windows to avoid alert flapping.

## Verification

`packages/core/src/tests/observability-pack.test.ts` (11 tests) validates the
default rule groups, that recording rules reference the real emitted metrics,
alert label/annotation requirements, the multi-window SLO structure, validator
negatives (dual record/alert, empty expr, missing severity, duplicate groups,
bad durations), the YAML serializer output, and the Grafana dashboard model +
validator.

```bash
cd packages/core && npx tsc && node --test dist/src/tests/observability-pack.test.js
node scripts/observability/emit-assets.mjs   # emits + validates the asset files
```
