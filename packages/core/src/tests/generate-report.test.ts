// tests/generate-report.test.ts
// Unit tests for the Consumer-Platform Certification Report generator
// (Task 19.2; Requirements 1.1, 12.1, 12.2, 12.3, 12.4, 12.5).
//
// These verify that `generateReport()` / `loadArtifactSources()` /
// `renderHumanReadable()`:
//  - read the recorded `<capabilityId>.artifact.json` files from the artifact
//    directory and feed them to `computeCertification` (Req 12.5);
//  - emit the machine-readable report (verbatim `CertificationReport`) and a
//    human-readable scorecard covering all eight categories (Req 12.1);
//  - list the unverified contributing features for a not-fully-certified
//    category (Req 12.3);
//  - reference the artifact paths as evidence in `computedFrom` and the text (Req 12.4);
//  - skip invalid/unreadable artifacts without aborting (Req 12.3);
//  - skip the human-readable file under `--json-only`.
//
// All checks run offline against a temp directory — no credentials, no network.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  generateReport,
  loadArtifactSources,
  renderHumanReadable,
  collectArtifactFiles,
  REPORT_JSON_FILENAME,
  REPORT_TEXT_FILENAME,
} from '../verification/generate-report.js';
import {
  CONSUMER_PLATFORM_CAPABILITIES,
  REPORT_CATEGORIES,
} from '../verification/certification.js';
import type { VerificationArtifact } from '../verification/artifact.js';
import type { VerificationStatus } from '../verification/status.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function artifact(capabilityId: string, status: VerificationStatus): VerificationArtifact {
  return {
    schemaVersion: 1,
    capabilityId,
    status,
    evidence: {
      sourceCode: status === 'VERIFIED',
      passingTests: status === 'VERIFIED',
      documentation: status === 'VERIFIED',
      artifact: status === 'VERIFIED',
    },
    command: `verify ${capabilityId}`,
    exitCode: status === 'VERIFIED' ? 0 : 1,
    timestamp: '2025-01-01T00:00:00.000Z',
    generator: { tool: 'test', version: '1.0.0' },
    ...(status === 'BLOCKED'
      ? { blockedReason: { missingPrerequisite: 'svc', kind: 'service' as const } }
      : {}),
  };
}

/** Write `<area>/<capabilityId>.artifact.json` under `root`, mirroring capture layout. */
function writeArtifact(root: string, a: VerificationArtifact): string {
  const area = a.capabilityId.split('.')[0] ?? a.capabilityId;
  const dir = join(root, area);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${a.capabilityId}.artifact.json`);
  writeFileSync(path, `${JSON.stringify(a, null, 2)}\n`, 'utf8');
  return path;
}

let root: string;
const CLOCK = new Date('2025-06-01T12:00:00.000Z');

before(() => {
  root = mkdtempSync(join(tmpdir(), 'cert-report-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

// ── Loading artifacts from disk (Req 12.5) ──────────────────────────────────────

describe('loadArtifactSources — reads recorded artifacts from the directory', () => {
  it('collects and validates every *.artifact.json, skipping invalid/unreadable ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-load-'));
    try {
      writeArtifact(dir, artifact('validation.runtime', 'VERIFIED'));
      writeArtifact(dir, artifact('ratelimit.sliding-window', 'PARTIAL'));
      // An invalid artifact (missing required fields) must be skipped.
      mkdirSync(join(dir, 'bad'), { recursive: true });
      writeFileSync(join(dir, 'bad', 'broken.artifact.json'), '{"not":"an artifact"}', 'utf8');
      // An unreadable (non-JSON) artifact must be skipped.
      writeFileSync(join(dir, 'bad', 'garbage.artifact.json'), 'not json at all', 'utf8');

      const silent = { log: () => {}, error: () => {} };
      const sources = loadArtifactSources(dir, silent);

      assert.equal(sources.length, 2);
      const ids = sources.map((s) => s.artifact.capabilityId).sort();
      assert.deepEqual(ids, ['ratelimit.sliding-window', 'validation.runtime']);
      for (const s of sources) assert.ok(s.path && s.path.endsWith('.artifact.json'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('collectArtifactFiles returns a deterministic sorted order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-collect-'));
    try {
      writeArtifact(dir, artifact('upload.guard', 'VERIFIED'));
      writeArtifact(dir, artifact('encryption.field', 'VERIFIED'));
      writeArtifact(dir, artifact('abuse.engine', 'VERIFIED'));
      const files = collectArtifactFiles(dir);
      assert.deepEqual([...files].sort(), files);
      assert.equal(files.length, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── End-to-end report generation (Req 12.1/12.4/12.5) ───────────────────────────

describe('generateReport — emits JSON + human-readable from captured artifacts', () => {
  it('produces the eight-category scorecard and writes both report files', () => {
    // Every capability VERIFIED ⇒ all categories fully certified.
    for (const id of CONSUMER_PLATFORM_CAPABILITIES) {
      writeArtifact(root, artifact(id, 'VERIFIED'));
    }

    const silent = { log: () => {}, error: () => {} };
    const result = generateReport({ artifactRoot: root, repoRoot: root, now: CLOCK, logger: silent });

    // Report shape (Req 12.1).
    assert.equal(result.report.categories.length, REPORT_CATEGORIES.length);
    assert.deepEqual(
      result.report.categories.map((c) => c.category),
      [...REPORT_CATEGORIES],
    );
    assert.ok(result.report.categories.every((c) => c.fullyCertified));

    // Provenance references the read artifact paths (Req 12.4).
    assert.equal(result.report.computedFrom.length, CONSUMER_PLATFORM_CAPABILITIES.length);

    // JSON file written verbatim and parseable.
    assert.ok(existsSync(result.jsonPath));
    assert.equal(result.jsonPath, join(root, REPORT_JSON_FILENAME));
    const persisted = JSON.parse(readFileSync(result.jsonPath, 'utf8'));
    assert.deepEqual(persisted, result.report);

    // Human-readable file written and lists all categories.
    assert.ok(result.textPath && existsSync(result.textPath));
    assert.equal(result.textPath, join(root, REPORT_TEXT_FILENAME));
    const text = readFileSync(result.textPath, 'utf8');
    for (const cat of REPORT_CATEGORIES) assert.ok(text.includes(cat), `text mentions ${cat}`);
    assert.match(text, /8\/8 fully certified/);
  });
});

// ── Not-fully-certified category lists unverified features (Req 12.3) ────────────

describe('generateReport — surfaces unverified features (Req 12.3)', () => {
  it('lists the unverified contributing feature when an artifact is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-missing-'));
    try {
      // Provide every capability EXCEPT moderation.toolkit (a Moderation contributor).
      for (const id of CONSUMER_PLATFORM_CAPABILITIES) {
        if (id === 'moderation.toolkit') continue;
        writeArtifact(dir, artifact(id, 'VERIFIED'));
      }
      const silent = { log: () => {}, error: () => {} };
      const { report, text } = generateReport({
        artifactRoot: dir,
        repoRoot: dir,
        now: CLOCK,
        logger: silent,
      });

      const moderation = report.categories.find((c) => c.category === 'Moderation');
      assert.ok(moderation);
      assert.equal(moderation.fullyCertified, false);
      assert.ok(moderation.unverified.some((c) => c.capabilityId === 'moderation.toolkit'));

      // Human-readable form flags the unverified feature (Req 12.3).
      assert.match(text, /NOT FULLY CERTIFIED/);
      assert.match(text, /unverified features: .*moderation\.toolkit/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('references the evidence artifact path for VERIFIED contributors (Req 12.4)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-evidence-'));
    try {
      const path = writeArtifact(dir, artifact('validation.runtime', 'VERIFIED'));
      const sources = loadArtifactSources(dir, { log: () => {}, error: () => {} });
      const report = generateReport({
        artifactRoot: dir,
        repoRoot: dir,
        now: CLOCK,
        jsonOnly: true,
        logger: { log: () => {}, error: () => {} },
      }).report;

      const text = renderHumanReadable(report, sources);
      // The VERIFIED contributor is annotated with the artifact path that evidences it.
      assert.ok(text.includes(path), 'text references the evidence artifact path');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── --json-only skips the human-readable file ───────────────────────────────────

describe('generateReport — json-only mode', () => {
  it('does not write the text report when jsonOnly is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-jsononly-'));
    try {
      writeArtifact(dir, artifact('privacy.controls', 'VERIFIED'));
      const result = generateReport({
        artifactRoot: dir,
        repoRoot: dir,
        now: CLOCK,
        jsonOnly: true,
        logger: { log: () => {}, error: () => {} },
      });
      assert.ok(existsSync(result.jsonPath));
      assert.equal(result.textPath, undefined);
      assert.ok(!existsSync(join(dir, REPORT_TEXT_FILENAME)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws a clear error when the artifact directory does not exist', () => {
    assert.throws(
      () => generateReport({ artifactRoot: join(root, 'nope'), repoRoot: root, now: CLOCK, logger: { log: () => {}, error: () => {} } }),
      /artifact directory not found/,
    );
  });
});
