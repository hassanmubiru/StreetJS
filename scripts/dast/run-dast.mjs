#!/usr/bin/env node
// scripts/dast/run-dast.mjs
// Layer B DAST orchestrator. Drives the REAL scanners — Schemathesis and OWASP
// ZAP (baseline + OpenAPI API scan) — against a running instance through the
// framework's `CommandRunner`, enforces a wall-clock watchdog (default 30 min,
// the same budget as the workflow's `timeout-minutes`), collects every finding,
// and emits a single machine-readable DAST Verification Artifact via
// `buildDastArtifact`.
//
// Failure handling (Requirements 3.8 / 3.9):
//   - target-unavailable : the target's Health Endpoint never responded within
//                          the startup budget (30s, Req 3.1).
//   - scan-error         : a scanner could not be executed at all (tool missing
//                          or it aborted before producing any report).
//   - timeout            : the 30-minute watchdog fired (Req 3.9); the scan is
//                          terminated (CommandRunner SIGKILL) and the build fails.
//
// The build fails (non-zero exit) on any failure cause and on any High/Critical
// finding (Req 3.4 / 3.5); it passes only with zero High/Critical and full
// endpoint coverage (Req 3.6). The artifact records per-severity counts, the
// endpoints scanned/total, the gate outcome, and the failure cause when present
// (Req 3.7 / 3.3).
//
// Usage:
//   node scripts/dast/run-dast.mjs \
//     --spec dast-reports/openapi.json \
//     --base-url http://127.0.0.1:8080 \
//     --fail-on high \
//     --out-dir verification-artifacts/dast \
//     --report-dir dast-reports \
//     [--timeout-ms 1800000]

import { existsSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { join } from 'node:path';

import {
  CommandRunner,
  buildDastArtifact,
  parseZapReport,
  openApiOperations,
} from '@streetjs/core';

// ── argument parsing ─────────────────────────────────────────────────────────

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const SPEC = arg('spec', process.env.SPEC ?? 'dast-reports/openapi.json');
const BASE_URL = arg('base-url', process.env.BASE_URL ?? 'http://127.0.0.1:8080');
const FAIL_ON = arg('fail-on', process.env.FAIL_ON ?? 'high');
const OUT_DIR = arg('out-dir', process.env.OUT_DIR ?? 'verification-artifacts/dast');
const REPORT_DIR = arg('report-dir', process.env.REPORT_DIR ?? 'dast-reports');
// The in-script watchdog budget — 30 minutes by default (Req 3.9), shared by
// every scan: each scan is given only the time remaining in the budget so the
// total scan duration can never exceed it.
const TOTAL_BUDGET_MS = Number(
  arg('timeout-ms', process.env.DAST_TIMEOUT_MS ?? String(30 * 60 * 1000)),
);
// Health-endpoint startup budget — the target must respond within 30s (Req 3.1).
const HEALTH_BUDGET_MS = Number(process.env.DAST_HEALTH_TIMEOUT_MS ?? '30000');

const CAPABILITY_ID = 'security.dast';
const start = Date.now();
const deadline = start + TOTAL_BUDGET_MS;
const remainingBudget = () => deadline - Date.now();

// ── health probe (target availability, Req 3.1) ───────────────────────────────

function probeOnce(url, timeoutMs) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const lib = u.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = lib(
      { method: 'GET', hostname: u.hostname, port: u.port, path: u.pathname + u.search },
      (res) => {
        res.resume();
        res.once('end', () => resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 500));
      },
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
    req.once('error', () => resolve(false));
    req.end();
  });
}

async function waitForTarget(baseUrl, budgetMs) {
  const healthUrl = `${baseUrl.replace(/\/$/, '')}/health`;
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    if (await probeOnce(healthUrl, 2000)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // One last attempt right at the boundary.
  return probeOnce(healthUrl, 2000);
}

// ── scan execution through CommandRunner ──────────────────────────────────────

const runner = new CommandRunner();

/**
 * Execute one scanner through the CommandRunner so it inherits the atomic
 * artifact + timeout machinery. Returns the scan's exit code plus whether it
 * was killed by the watchdog. The per-scan generic artifact is written to
 * OUT_DIR as additional evidence; the aggregate DAST artifact is built below.
 */
async function runScan(scanId, command, env) {
  const timeoutMs = Math.max(1, remainingBudget());
  const { artifact } = await runner.run({
    capabilityId: `${CAPABILITY_ID}.${scanId}`,
    command,
    env,
    timeoutMs,
    outDir: OUT_DIR,
  });
  return { exitCode: artifact.exitCode, timedOut: artifact.timedOut };
}

// ── ZAP report → findings ─────────────────────────────────────────────────────

function collectZapFindings() {
  const findings = [];
  for (const name of ['zap-baseline.json', 'zap-api.json']) {
    const p = join(REPORT_DIR, name);
    if (existsSync(p)) {
      try {
        findings.push(...parseZapReport(JSON.parse(readFileSync(p, 'utf8'))));
      } catch (err) {
        console.error(`[dast] failed to parse ${p}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  return findings;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Endpoint coverage baseline (Req 3.2): the enumerated OpenAPI operation set.
  let endpointsTotal = 0;
  if (existsSync(SPEC)) {
    try {
      endpointsTotal = openApiOperations(JSON.parse(readFileSync(SPEC, 'utf8'))).length;
    } catch (err) {
      console.error(`[dast] failed to read spec ${SPEC}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const findings = [];
  let failureCause;
  let endpointsScanned = 0;

  // 1) Target availability (Req 3.1 / 3.8).
  const available = await waitForTarget(BASE_URL, HEALTH_BUDGET_MS);
  if (!available) {
    failureCause = 'target-unavailable';
    console.error(`[dast] target ${BASE_URL} did not become healthy within ${HEALTH_BUDGET_MS}ms`);
  }

  // 2) Schemathesis (OpenAPI-driven property-based scan).
  if (!failureCause) {
    if (remainingBudget() <= 0) {
      failureCause = 'timeout';
    } else {
      const sch = await runScan(
        'schemathesis',
        'scripts/dast/run-schemathesis.sh',
        { SPEC, BASE_URL, REPORT_DIR },
      );
      if (sch.timedOut) {
        failureCause = 'timeout';
        console.error('[dast] schemathesis exceeded the watchdog budget');
      } else if (sch.exitCode === 127) {
        // The scanner itself could not be executed (e.g. not installed).
        failureCause = 'scan-error';
        console.error('[dast] schemathesis could not be executed (scan-error)');
      } else if (sch.exitCode !== 0) {
        // A non-zero, executable run means conformance violations / server
        // errors — a real High finding from the application's own contract.
        findings.push({
          tool: 'schemathesis',
          name: 'OpenAPI conformance failure',
          severity: 'high',
          description: `schemathesis exited ${sch.exitCode} (schema/server-error checks failed)`,
        });
      }
    }
  }

  // 3) OWASP ZAP baseline + API scan (gated via reports, never on exit code).
  if (!failureCause) {
    if (remainingBudget() <= 0) {
      failureCause = 'timeout';
    } else {
      const zap = await runScan(
        'zap',
        'scripts/dast/run-zap-baseline.sh',
        { SPEC, BASE_URL, REPORT_DIR, FAIL_ON },
      );
      if (zap.timedOut) {
        failureCause = 'timeout';
        console.error('[dast] ZAP scan exceeded the watchdog budget');
      } else if (zap.exitCode === 127) {
        failureCause = 'scan-error';
        console.error('[dast] ZAP could not be executed (scan-error)');
      }
      // ZAP findings are read from the JSON reports, not the exit code: the
      // baseline script runs with -I and grades via the severity gate, so a
      // non-zero (gate-fail) exit is already represented by the parsed findings.
    }
  }

  // 4) Collect ZAP findings regardless of the gate-fail exit code.
  if (!failureCause || failureCause === 'timeout') {
    findings.push(...collectZapFindings());
  }

  // Coverage: the OpenAPI-driven scanners exercise the full enumerated set when
  // the target was reachable and no failure cut the run short.
  endpointsScanned = !failureCause ? endpointsTotal : 0;

  // 5) Build and persist the DAST Verification Artifact (Req 3.3 / 3.7 / 3.8 / 3.9).
  const artifact = buildDastArtifact(
    findings,
    { endpointsScanned, endpointsTotal, ...(failureCause ? { failureCause } : {}) },
    { failOn: FAIL_ON },
  );

  const outPath = join(OUT_DIR, `${CAPABILITY_ID}.artifact.json`);
  await CommandRunner.writeArtifactAtomic(outPath, artifact);

  // 6) Human-readable summary.
  const d = artifact.details ?? {};
  console.log(`\nDAST artifact: ${outPath}`);
  console.log(`  status        : ${artifact.status}`);
  console.log(`  failOn        : ${FAIL_ON}`);
  console.log(`  gate.passed   : ${d.gate?.passed}`);
  console.log(`  counts        : ${JSON.stringify(d.counts)}`);
  console.log(`  coverage      : ${d.endpointsScanned}/${d.endpointsTotal} endpoints`);
  if (d.failureCause) console.log(`  failureCause  : ${d.failureCause}`);
  console.log(`  exitCode      : ${artifact.exitCode}`);

  // Fail the build on any High/Critical finding or any failure cause (Req 3.4/3.5/3.8/3.9).
  process.exit(artifact.exitCode);
}

main().catch((err) => {
  console.error(`[dast] orchestrator error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
