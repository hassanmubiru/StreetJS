#!/usr/bin/env node
// scripts/release/derive-inputs.mjs
//
// Derives the machine-measurable portion of release-inputs.json live, from
// real evidence sources, on every CI run — closing the gap where
// `release-inputs.json` (gitignored, "generated build/release artifact") was
// never actually generated anywhere, so the Release Engineering Enforcement
// gate always fell back to the honest zero-score default (Req 11.6).
//
// What this derives, and what it deliberately does NOT:
//   - security  : LIVE from the public OpenSSF Scorecard API
//                 (api.securityscorecards.dev), no credentials required.
//                 Scorecard score is 0-10; scaled ×10 to the 0-100 scale
//                 render-report.mjs expects (Req 11.1).
//   - coverage  : LIVE from packages/core's own c8/lcov coverage report
//                 (coverage/lcov.info), summing LF/LH across every SF: record
//                 for an aggregate line-coverage percentage — the same
//                 "headline = line coverage" convention the maintainer's own
//                 evidence documented previously.
//   - reliability / performance : NOT derived here. These are explicitly
//                 rubric-based, maintainer-assessment dimensions (see the
//                 project's own prior evidence: "Rubric-based score, not a
//                 single external measurement"). Inventing a formula for them
//                 would be fabricated evidence, which this project's zero-trust
//                 design (Req 11.6) exists specifically to prevent. If a
//                 maintainer-supplied inputs file already carries values for
//                 these dimensions, this script PRESERVES them via a shallow
//                 merge against the git-TRACKED `release-inputs.template.json`
//                 (default merge source — see --merge below); otherwise they
//                 are left absent (render-report.mjs's own zero-default then
//                 applies honestly).
//   - health (dependencyFreshness/testTrends/vulnerabilityTrends) : NOT
//                 derived here. These are current-vs-previous-release deltas
//                 and require a stored cross-release baseline that does not
//                 yet exist; deriving them would need new persistence
//                 infrastructure, out of scope for this script. Any
//                 maintainer-supplied health block is preserved as-is.
//
// Usage:
//   node scripts/release/derive-inputs.mjs [--out release-inputs.json]
//     [--coverage-lcov packages/core/coverage/lcov.info]
//     [--repo github.com/OWNER/REPO]
//     [--merge release-inputs.template.json]   (default; git-tracked template)
//
// Network failures (OpenSSF API unreachable) are non-fatal: that dimension is
// simply omitted (never fabricated as a passing score), and a warning is
// printed. This mirrors the render-report.mjs "no evidence => no credit" rule.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import https from 'node:https';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    }
  }
  return flags;
}

/** Fetch a URL over HTTPS and parse the response body as JSON. Rejects on any
 * non-2xx status or network error — callers treat that as "no evidence". */
function fetchJson(url, timeoutMs = 10_000) {
  return new Promise((resolvePromise, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolvePromise(JSON.parse(body)); }
        catch (err) { reject(new Error(`Invalid JSON from ${url}: ${err.message}`)); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error(`Timeout fetching ${url}`)); });
    req.on('error', reject);
  });
}

/** Sum LF/LH across every SF: record in an lcov.info file; returns a 0-100
 * line-coverage percentage, or null if the file is absent/unparseable. */
function lineCoverageFromLcov(lcovPath) {
  if (!existsSync(lcovPath)) return null;
  const text = readFileSync(lcovPath, 'utf8');
  let linesFound = 0, linesHit = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('LF:')) linesFound += Number(line.slice(3)) || 0;
    else if (line.startsWith('LH:')) linesHit += Number(line.slice(3)) || 0;
  }
  if (linesFound <= 0) return null;
  return (linesHit / linesFound) * 100;
}

async function deriveSecurity(repoSlug) {
  const url = `https://api.securityscorecards.dev/projects/${repoSlug}`;
  try {
    const json = await fetchJson(url);
    if (typeof json.score !== 'number') throw new Error('missing "score" field');
    return {
      score: Math.round(json.score * 10 * 100) / 100, // 0-10 -> 0-100
      source: `OpenSSF Scorecard (api.securityscorecards.dev) live aggregate ${json.score}/10 for ${repoSlug}`,
      measured: json.date ?? new Date().toISOString().slice(0, 10),
      commit: json.repo?.commit,
    };
  } catch (err) {
    console.warn(`::warning::security dimension not derived — ${err.message}`);
    return null;
  }
}

function deriveCoverage(lcovPath) {
  const pct = lineCoverageFromLcov(lcovPath);
  if (pct === null) {
    console.warn(`::warning::coverage dimension not derived — no readable lcov.info at ${lcovPath}`);
    return null;
  }
  return {
    score: Math.round(pct * 100) / 100,
    source: `Measured aggregate line coverage ${pct.toFixed(2)}% from ${lcovPath} (c8/lcov), derived live this run.`,
    measured: new Date().toISOString().slice(0, 10),
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const outPath = resolve(REPO_ROOT, flags.out || 'release-inputs.json');
  const lcovPath = resolve(REPO_ROOT, flags['coverage-lcov'] || 'packages/core/coverage/lcov.info');
  const repoSlug = flags.repo || 'github.com/hassanmubiru/StreetJS';
  // Default merge source is the git-TRACKED template (maintainer-owned rubric
  // dimensions + thresholds + health), not the gitignored output path — that
  // file may not exist at all on a fresh checkout, which is exactly the bug
  // this script fixes. `--merge` may still override for local iteration.
  const mergePath = resolve(REPO_ROOT, flags.merge || 'scripts/release/release-inputs.template.json');

  // Preserve any existing maintainer-supplied rubric-based dimensions/health
  // via a shallow merge — this script only OVERWRITES the fields it can
  // actually measure live; it never invents reliability/performance/health.
  let existing = {};
  if (existsSync(mergePath)) {
    try { existing = JSON.parse(readFileSync(mergePath, 'utf8')); }
    catch { existing = {}; }
  }

  const [security, coverage] = await Promise.all([
    deriveSecurity(repoSlug),
    Promise.resolve(deriveCoverage(lcovPath)),
  ]);

  const scorecard = { ...(existing.scorecard ?? {}) };
  const evidence = { ...(existing._evidence ?? {}) };

  if (security) {
    scorecard.security = security.score;
    evidence.security = {
      score: security.score,
      source: security.source,
      measured: security.measured,
      derivedBy: 'scripts/release/derive-inputs.mjs (live, this run)',
    };
  }
  if (coverage) {
    scorecard.coverage = coverage.score;
    evidence.coverage = {
      score: coverage.score,
      source: coverage.source,
      measured: coverage.measured,
      derivedBy: 'scripts/release/derive-inputs.mjs (live, this run)',
    };
  }

  const merged = {
    _comment: existing._comment ??
      'Release Engineering scorecard evidence (Req 11). security+coverage are derived live by scripts/release/derive-inputs.mjs on every CI run; reliability+performance (and health trends) remain maintainer-supplied rubric-based inputs — never fabricated.',
    scorecard,
    thresholds: existing.thresholds ?? {},
    health: existing.health ?? undefined,
    _evidence: evidence,
  };

  writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  const derived = [security && 'security', coverage && 'coverage'].filter(Boolean);
  const missing = RELEASE_DIMENSIONS_NOTE.filter((d) => !(d in scorecard));
  console.log(`Wrote ${outPath}`);
  console.log(`  live-derived this run: ${derived.length ? derived.join(', ') : '(none)'}`);
  console.log(`  not derived (maintainer-supplied or absent): ${missing.length ? missing.join(', ') : '(none)'}`);
}

const RELEASE_DIMENSIONS_NOTE = ['security', 'reliability', 'coverage', 'performance'];

main().catch((err) => {
  console.error('::error::derive-inputs.mjs failed:', err.message);
  process.exit(1);
});
