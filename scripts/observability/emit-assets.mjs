#!/usr/bin/env node
// scripts/observability/emit-assets.mjs
// Emit the Street observability pack to disk: Prometheus rule files (YAML) and
// the Grafana dashboard (JSON), validating each before writing. Deterministic
// and reproducible — safe to run in CI to publish/refresh the assets.

import { mkdirSync, writeFileSync } from 'node:fs';
import {
  streetRuleGroups, validatePrometheusRuleGroups, serializePrometheusRulesYaml,
  streetApiDashboard, validateGrafanaDashboard,
} from 'streetjs';

const promDir = 'observability/prometheus';
const grafDir = 'observability/grafana/dashboards';
mkdirSync(promDir, { recursive: true });
mkdirSync(grafDir, { recursive: true });

const groups = streetRuleGroups();
const rv = validatePrometheusRuleGroups(groups);
if (!rv.valid) { console.error('Prometheus rules invalid:\n  ' + rv.errors.join('\n  ')); process.exit(1); }
writeFileSync(`${promDir}/street-rules.yml`, serializePrometheusRulesYaml(groups));

const dash = streetApiDashboard();
const dv = validateGrafanaDashboard(dash);
if (!dv.valid) { console.error('Grafana dashboard invalid:\n  ' + dv.errors.join('\n  ')); process.exit(1); }
writeFileSync(`${grafDir}/street-api.json`, JSON.stringify(dash, null, 2) + '\n');

console.log('observability assets emitted + validated:');
console.log(`  ${promDir}/street-rules.yml (${groups.length} groups, ${groups.reduce((n, g) => n + g.rules.length, 0)} rules)`);
console.log(`  ${grafDir}/street-api.json (${dash.panels.length} panels)`);
