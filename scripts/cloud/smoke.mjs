#!/usr/bin/env node
// scripts/cloud/smoke.mjs
//
// Per-target health + smoke verification against a deployed instance
// (Requirements 2.9, 2.10). Polls `/health/live` and `/health/ready` (each ≤ 5s
// per request) and runs the smoke checks (≤ 300s, 0 failed / 0 errored), then
// prints a machine-readable result and exits non-zero when any bound is
// exceeded so a CI step fails on a degraded deployment.
//
// Usage:
//   BASE_URL=https://<deployed-url> node scripts/cloud/smoke.mjs [--checks <file.json>]
//   node scripts/cloud/smoke.mjs --base-url https://<url> --checks scripts/cloud/checks.json
//
// Exit codes: 0 = within bounds, 1 = bounds exceeded, 2 = BASE_URL missing.

import {
  probeHealth,
  runSmoke,
  loadSmokeChecks,
  parseFlags,
  HEALTH_LATENCY_BUDGET_MS,
  SMOKE_DURATION_BUDGET_MS,
} from './lib.mjs';

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const baseUrl = flags['base-url'] ?? process.env.BASE_URL;

  if (!baseUrl) {
    console.error('[cloud-smoke] BASE_URL is required (the deployed instance URL).');
    process.exitCode = 2;
    return;
  }

  const { health, log: healthLog } = await probeHealth(baseUrl);
  const checks = loadSmokeChecks(flags.checks);
  const smoke = await runSmoke(baseUrl, checks);

  const healthOk =
    health.live && health.ready && health.maxLatencyMs <= HEALTH_LATENCY_BUDGET_MS;
  const smokeOk =
    smoke.failed === 0 && smoke.errored === 0 && smoke.durationMs <= SMOKE_DURATION_BUDGET_MS;

  console.log('[cloud-smoke] health:');
  console.log(healthLog.replace(/^/gm, '  '));
  console.log('[cloud-smoke] smoke:');
  console.log(smoke.output.replace(/^/gm, '  '));
  console.log(JSON.stringify({ health, smoke }, null, 2));

  process.exitCode = healthOk && smokeOk ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[cloud-smoke] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
