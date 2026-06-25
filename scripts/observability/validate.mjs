#!/usr/bin/env node
// scripts/observability/validate.mjs
//
// Advanced Observability — the validation pipeline command (Req 10.6 / 10.7 /
// 10.8). This is the real command executed (through `CommandRunner` by
// run-validate.mjs) and is also runnable standalone for local debugging.
//
// Pipeline:
//   1. OFFLINE validators (always run, no external prerequisite):
//        • validateMetricReferences   — anti-fabrication guard (Req 10.1/10.7)
//        • validatePrometheusRuleGroups — rule structure/semantics (Req 10.6/10.8)
//        • validateGrafanaDashboard    — dashboard structure       (Req 10.6/10.8)
//      On any violation the pipeline FAILS (exit 1) after printing the offending
//      metric/asset or the validation error.
//   2. Emit the assets to disk (rule YAML + dashboard JSON) so promtool has real
//      files to check.
//   3. promtool SEMANTIC validation over the emitted rule files:
//        • promtool check rules  — semantic validity of recording/alert rules
//        • promtool test rules   — alert-behaviour unit tests
//      On failure the pipeline FAILS (exit 1). When promtool is unavailable the
//      promtool pass is SKIPPED cleanly (exit 0); run-validate.mjs's prerequisite
//      probe records the honest BLOCKED — never a mock, never a false VERIFIED.
//
// Exit code: 0 when every executed check passes (and promtool, if present,
// passes); non-zero when any validation fails — so a real failure fails the CI
// step while an honest promtool-absent skip does not.
//
// _Design: Components → Advanced Observability (validation pipeline); Error
//  Handling 10.7/10.8. Requirements: 10.6, 10.7, 10.8_

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runOfflineValidations, hasPromtool } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EMIT_SCRIPT = resolve(HERE, 'emit-assets.mjs');

// Emitted asset locations (relative to the repo root / process cwd).
const RULES_DIR = 'infra/monitoring/prometheus';
const RULES_FILE = `${RULES_DIR}/street-rules.yml`;
const RULES_TEST_FILE = 'street-rules.test.yml';

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: 'inherit', ...opts });
}

export function main() {
  // ── 1. Offline validation pipeline ──────────────────────────────────────
  const offline = runOfflineValidations();
  if (!offline.ok) {
    console.error('[observability-validate] FAIL — observability validation errors:');
    for (const e of offline.errors) console.error(`  - ${e}`);
    return 1;
  }
  console.log('[observability-validate] offline validation passed:');
  console.log('  - metric references: every referenced metric is an Exported Metric (anti-fabrication)');
  console.log('  - prometheus rule groups: structurally valid');
  console.log('  - grafana dashboards: structurally valid');

  // ── 2. Emit assets to disk for promtool ─────────────────────────────────
  const emit = run(process.execPath, [EMIT_SCRIPT]);
  if (emit.status !== 0) {
    console.error('[observability-validate] FAIL — could not emit observability assets');
    return emit.status ?? 1;
  }

  // ── 3. promtool semantic validation (or honest skip) ─────────────────────
  if (!hasPromtool()) {
    console.log(
      '[observability-validate] promtool unavailable — semantic rule validation SKIPPED ' +
        '(honest BLOCKED recorded by the driver; offline validation above still ran).',
    );
    return 0;
  }

  const check = run('promtool', ['check', 'rules', RULES_FILE]);
  if (check.status !== 0) {
    console.error('[observability-validate] FAIL — promtool check rules reported errors');
    return check.status ?? 1;
  }

  const test = run('promtool', ['test', 'rules', RULES_TEST_FILE], { cwd: RULES_DIR });
  if (test.status !== 0) {
    console.error('[observability-validate] FAIL — promtool test rules reported failures');
    return test.status ?? 1;
  }

  console.log('[observability-validate] promtool check rules + test rules passed.');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
