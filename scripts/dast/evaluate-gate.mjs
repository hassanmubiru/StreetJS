#!/usr/bin/env node
// scripts/dast/evaluate-gate.mjs
// Consume an OWASP ZAP baseline JSON report (and/or a normalized findings JSON),
// apply the severity gate, print a human + machine-readable summary, and exit
// with a deterministic code (0 = pass, 2 = fail on High/Critical).
//
// Usage:
//   node scripts/dast/evaluate-gate.mjs --zap <zap-report.json> [--fail-on high] [--out gate.json]
//   node scripts/dast/evaluate-gate.mjs --findings <findings.json> [--fail-on high]

import { readFileSync, writeFileSync } from 'node:fs';
import { parseZapReport, evaluateDastGate } from 'streetjs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const zapPath = arg('zap');
const findingsPath = arg('findings');
const failOn = arg('fail-on', 'high');
const outPath = arg('out');

let findings = [];
if (zapPath) {
  findings = findings.concat(parseZapReport(JSON.parse(readFileSync(zapPath, 'utf8'))));
}
if (findingsPath) {
  findings = findings.concat(JSON.parse(readFileSync(findingsPath, 'utf8')));
}
if (!zapPath && !findingsPath) {
  console.error('error: provide --zap <file> and/or --findings <file>');
  process.exit(64);
}

const gate = evaluateDastGate(findings, { failOn });

const report = {
  failOn: gate.failOn,
  passed: gate.passed,
  counts: gate.counts,
  offending: gate.offending,
  total: findings.length,
};
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`DAST gate (failOn=${gate.failOn}): ${gate.passed ? 'PASS' : 'FAIL'}`);
console.log(`  counts: ${JSON.stringify(gate.counts)}`);
if (!gate.passed) {
  console.log(`  offending (${gate.offending.length}):`);
  for (const f of gate.offending) console.log(`    [${f.severity}] ${f.tool}: ${f.name}${f.url ? ' @ ' + f.url : ''}`);
}
process.exit(gate.exitCode);
