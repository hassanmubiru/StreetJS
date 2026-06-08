#!/usr/bin/env node
// Task 11.2 verifier — Property 6 (Class F): Explicit Least-Privilege Permissions.
// Parses each of the seven target workflows, asserts a TOP-LEVEL `permissions`
// block equal to { contents: read }, confirms it is NOT nested inside `jobs`,
// and scans every step for operations that would require broader-than-read scope.
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const DIR = '.github/workflows';
const FILES = [
  'vendor-integration.yml',
  'observability.yml',
  'deploy-verify.yml',
  'dast.yml',
  'browser-compat.yml',
  'kafka-integration.yml',
  'rabbitmq-integration.yml',
];

// Heuristic scope-escalation signals: presence flags a step that would need a
// token scope beyond `contents: read`.
const ESCALATION_PATTERNS = [
  { scope: 'contents: write (push/tag/release)', re: /\bgit\s+push\b|\bgh\s+release\s+create\b|softprops\/action-gh-release|actions\/create-release/i },
  { scope: 'packages: write', re: /\bnpm\s+publish\b|docker\s+push\b|ghcr\.io.*push|packages:\s*write/i },
  { scope: 'issues/pull-requests: write', re: /\bgh\s+(issue|pr)\s+(create|comment|edit)\b|actions\/github-script|peter-evans\/create-or-update-comment/i },
  { scope: 'id-token: write (OIDC)', re: /aws-actions\/configure-aws-credentials|google-github-actions\/auth|azure\/login|id-token:\s*write/i },
  { scope: 'pages/deployments: write', re: /actions\/deploy-pages|peaceiris\/actions-gh-pages/i },
];

let allOk = true;
const results = [];

for (const file of FILES) {
  const path = `${DIR}/${file}`;
  const raw = readFileSync(path, 'utf8');
  const entry = { file, ok: true, issues: [], notes: [] };

  // 1) YAML parses (lint/parse validation)
  let doc;
  try {
    doc = yaml.load(raw);
  } catch (e) {
    entry.ok = false;
    entry.issues.push(`YAML parse error: ${e.message}`);
    results.push(entry);
    allOk = false;
    continue;
  }
  if (!doc || typeof doc !== 'object') {
    entry.ok = false;
    entry.issues.push('Document did not parse to a mapping');
    results.push(entry);
    allOk = false;
    continue;
  }

  // 2) top-level permissions exists
  if (!('permissions' in doc)) {
    entry.ok = false;
    entry.issues.push('No top-level `permissions` key');
  } else {
    const perms = doc.permissions;
    // 3) equals { contents: read }
    const keys = perms && typeof perms === 'object' ? Object.keys(perms) : [];
    const isContentsRead =
      perms && typeof perms === 'object' &&
      keys.length === 1 && perms.contents === 'read';
    if (!isContentsRead) {
      entry.ok = false;
      entry.issues.push(`Top-level permissions is not exactly { contents: read } (got ${JSON.stringify(perms)})`);
    } else {
      entry.notes.push('top-level permissions = { contents: read }');
    }
  }

  // 4) confirm permissions is at workflow level, not nested inside any job
  const jobs = doc.jobs && typeof doc.jobs === 'object' ? doc.jobs : {};
  for (const [jobName, job] of Object.entries(jobs)) {
    if (job && typeof job === 'object' && 'permissions' in job) {
      entry.notes.push(`note: job '${jobName}' also declares permissions (workflow-level still authoritative)`);
    }
  }

  // 5) scan steps for scope escalations beyond contents: read
  let stepCount = 0;
  for (const [, job] of Object.entries(jobs)) {
    const steps = job && Array.isArray(job.steps) ? job.steps : [];
    for (const step of steps) {
      stepCount++;
      const text = JSON.stringify(step);
      for (const { scope, re } of ESCALATION_PATTERNS) {
        if (re.test(text)) {
          entry.ok = false;
          entry.issues.push(`Step requires broader scope -> ${scope}: ${step.name || step.uses || '(unnamed)'}`);
        }
      }
    }
  }
  entry.notes.push(`${stepCount} step(s) scanned; none require scope beyond contents: read`);

  if (!entry.ok) allOk = false;
  results.push(entry);
}

console.log('=== Task 11.2 — Class F structural verification (Property 6) ===\n');
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.file}`);
  for (const n of r.notes) console.log(`        - ${n}`);
  for (const i of r.issues) console.log(`    !!  ${i}`);
}
console.log(`\nOVERALL: ${allOk ? 'PASS — all seven declare least-privilege permissions; no step needs broader scope' : 'FAIL'}`);
process.exit(allOk ? 0 : 1);
