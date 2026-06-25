#!/usr/bin/env node
// scripts/observability/emit-assets.mjs
// Emit the Street observability pack to disk: Prometheus rule files (YAML) and
// the Grafana dashboard (JSON), validating each before writing. Deterministic
// and reproducible — safe to run in CI to publish/refresh the assets.

import { mkdirSync, writeFileSync } from 'node:fs';
import {
  streetRuleGroups, validatePrometheusRuleGroups, serializePrometheusRulesYaml,
  streetDashboards, validateGrafanaDashboard,
} from 'streetjs';

const promDir = 'infra/monitoring/prometheus';
const grafDir = 'infra/monitoring/grafana/dashboards';
mkdirSync(promDir, { recursive: true });
mkdirSync(grafDir, { recursive: true });

const groups = streetRuleGroups();
const rv = validatePrometheusRuleGroups(groups);
if (!rv.valid) { console.error('Prometheus rules invalid:\n  ' + rv.errors.join('\n  ')); process.exit(1); }
writeFileSync(`${promDir}/street-rules.yml`, serializePrometheusRulesYaml(groups));

const dashboards = streetDashboards();
for (const dash of dashboards) {
  const dv = validateGrafanaDashboard(dash);
  if (!dv.valid) { console.error(`Grafana dashboard "${dash.uid}" invalid:\n  ` + dv.errors.join('\n  ')); process.exit(1); }
  writeFileSync(`${grafDir}/${dash.uid}.json`, JSON.stringify(dash, null, 2) + '\n');
}

console.log('observability assets emitted + validated:');
console.log(`  ${promDir}/street-rules.yml (${groups.length} groups, ${groups.reduce((n, g) => n + g.rules.length, 0)} rules)`);
for (const dash of dashboards) {
  console.log(`  ${grafDir}/${dash.uid}.json (${dash.panels.length} panels)`);
}
