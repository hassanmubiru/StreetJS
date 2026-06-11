// packages/cli/src/tests/verify.test.ts
// Unit tests for `street verify --aggregate`.
//
// These verify that the CLI reads recorded Verification Artifacts from
// `verification-artifacts/`, drives the real `computeLeadership` aggregator from
// @streetjs/core, and persists ONLY the aggregator's output to
// `platform-leadership.report.json` (Req 12.4/12.5). The CLI never computes or
// edits the decision itself — it loads artifacts, calls the aggregator, and
// writes the returned report verbatim.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { PLATFORM_LEADERSHIP_CAPABILITIES } from 'streetjs';
import type { VerificationArtifact, VerificationStatus } from 'streetjs';

import { VerifyCommand } from '../commands/verify.js';
import type { CliContext } from '../index.js';

interface Captured {
  logs: string[];
  errors: string[];
}

function captureConsole(): { output: Captured; restore: () => void } {
  const output: Captured = { logs: [], errors: [] };
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => { output.logs.push(args.map(String).join(' ')); };
  console.error = (...args: unknown[]) => { output.errors.push(args.map(String).join(' ')); };
  return { output, restore: () => { console.log = origLog; console.error = origErr; } };
}

function aggregateCtx(cwd: string, out?: string): CliContext {
  const flags: Record<string, string | boolean> = { aggregate: true };
  if (out) flags['out'] = out;
  return { cwd, args: { command: 'verify', positional: [], flags } };
}

/** Build a schema-valid artifact for a capability with the given status. */
function makeArtifact(capabilityId: string, status: VerificationStatus): VerificationArtifact {
  const artifact: VerificationArtifact = {
    schemaVersion: 1,
    capabilityId,
    status,
    evidence: {
      sourceCode: true,
      passingTests: status === 'VERIFIED',
      documentation: true,
      artifact: true,
    },
    command: 'npm test',
    exitCode: status === 'VERIFIED' ? 0 : 1,
    timestamp: '2025-01-01T00:00:00.000Z',
    durationMs: 10,
    timedOut: false,
    generator: { tool: 'street-verify', version: '1.0.0' },
  };
  if (status === 'BLOCKED') {
    artifact.blockedReason = { missingPrerequisite: 'kubectl', kind: 'runtime' };
  }
  return artifact;
}

/**
 * Write an artifact under `<root>/<area>/<capabilityId>.artifact.json` where
 * `<area>` is the first dotted segment — mirroring the standard layout.
 */
function writeArtifact(root: string, artifact: VerificationArtifact): void {
  const area = artifact.capabilityId.split('.')[0]!;
  const dir = join(root, area);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${artifact.capabilityId}.artifact.json`),
    JSON.stringify(artifact, null, 2),
  );
}

void describe('VerifyCommand --aggregate', () => {
  let tmpDir: string;
  let artifactRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'street-verify-aggregate-'));
    artifactRoot = join(tmpDir, 'verification-artifacts');
    mkdirSync(artifactRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('GRANTS leadership and writes the report when every required capability is VERIFIED', async () => {
    for (const capabilityId of PLATFORM_LEADERSHIP_CAPABILITIES) {
      writeArtifact(artifactRoot, makeArtifact(capabilityId, 'VERIFIED'));
    }

    const { output, restore } = captureConsole();
    try {
      await new VerifyCommand().execute(aggregateCtx(tmpDir));
    } finally {
      restore();
    }

    const reportPath = join(artifactRoot, 'platform-leadership.report.json');
    assert.ok(existsSync(reportPath), 'report file should be written');

    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.decision, 'GRANTED');
    assert.equal(report.withheld.length, 0);
    assert.equal(report.required.length, PLATFORM_LEADERSHIP_CAPABILITIES.length);
    assert.equal(process.exitCode, 0, 'GRANTED should yield exit code 0');
    assert.ok(output.logs.some((l) => l.includes('GRANTED')));
  });

  it('WITHHOLDS leadership when a required capability is not VERIFIED', async () => {
    for (const capabilityId of PLATFORM_LEADERSHIP_CAPABILITIES) {
      writeArtifact(artifactRoot, makeArtifact(capabilityId, 'VERIFIED'));
    }
    // Override one capability to a non-VERIFIED status.
    const offending = PLATFORM_LEADERSHIP_CAPABILITIES[1]!;
    writeArtifact(artifactRoot, makeArtifact(offending, 'PARTIAL'));

    const { restore } = captureConsole();
    try {
      await new VerifyCommand().execute(aggregateCtx(tmpDir));
    } finally {
      restore();
    }

    const report = JSON.parse(readFileSync(join(artifactRoot, 'platform-leadership.report.json'), 'utf8'));
    assert.equal(report.decision, 'WITHHELD');
    assert.ok(
      report.withheld.some((c: { capabilityId: string; status: string }) =>
        c.capabilityId === offending && c.status === 'PARTIAL'),
      'the offending capability should appear in withheld with its status',
    );
    assert.equal(process.exitCode, 1, 'WITHHELD should yield a non-zero exit code');
  });

  it('treats a missing artifact as not VERIFIED (WITHHELD) — Req 12.3', async () => {
    // Write artifacts for all but the last required capability.
    for (const capabilityId of PLATFORM_LEADERSHIP_CAPABILITIES.slice(0, -1)) {
      writeArtifact(artifactRoot, makeArtifact(capabilityId, 'VERIFIED'));
    }
    const missing = PLATFORM_LEADERSHIP_CAPABILITIES[PLATFORM_LEADERSHIP_CAPABILITIES.length - 1]!;

    const { restore } = captureConsole();
    try {
      await new VerifyCommand().execute(aggregateCtx(tmpDir));
    } finally {
      restore();
    }

    const report = JSON.parse(readFileSync(join(artifactRoot, 'platform-leadership.report.json'), 'utf8'));
    assert.equal(report.decision, 'WITHHELD');
    const entry = report.required.find((c: { capabilityId: string }) => c.capabilityId === missing);
    assert.ok(entry, 'the missing capability should still be reported');
    assert.equal(entry.hasArtifact, false, 'the missing capability should be flagged hasArtifact=false');
    assert.ok(
      report.withheld.some((c: { capabilityId: string }) => c.capabilityId === missing),
      'the missing capability should be withheld',
    );
  });

  it('records provenance (computedFrom) of the artifacts it read', async () => {
    for (const capabilityId of PLATFORM_LEADERSHIP_CAPABILITIES) {
      writeArtifact(artifactRoot, makeArtifact(capabilityId, 'VERIFIED'));
    }

    const { restore } = captureConsole();
    try {
      await new VerifyCommand().execute(aggregateCtx(tmpDir));
    } finally {
      restore();
    }

    const report = JSON.parse(readFileSync(join(artifactRoot, 'platform-leadership.report.json'), 'utf8'));
    assert.equal(report.computedFrom.length, PLATFORM_LEADERSHIP_CAPABILITIES.length);
    for (const p of report.computedFrom) {
      assert.ok(p.endsWith('.artifact.json'), 'each provenance path should be an artifact file');
    }
  });

  it('skips malformed artifacts without aborting the aggregation', async () => {
    for (const capabilityId of PLATFORM_LEADERSHIP_CAPABILITIES) {
      writeArtifact(artifactRoot, makeArtifact(capabilityId, 'VERIFIED'));
    }
    // Drop a non-conforming file into the tree — it must be skipped, not crash.
    const junkDir = join(artifactRoot, 'junk');
    mkdirSync(junkDir, { recursive: true });
    writeFileSync(join(junkDir, 'broken.artifact.json'), '{ not valid json');
    writeFileSync(join(junkDir, 'incomplete.artifact.json'), JSON.stringify({ capabilityId: 'x.y' }));

    const { restore } = captureConsole();
    try {
      await new VerifyCommand().execute(aggregateCtx(tmpDir));
    } finally {
      restore();
    }

    const report = JSON.parse(readFileSync(join(artifactRoot, 'platform-leadership.report.json'), 'utf8'));
    // The valid VERIFIED set still grants leadership despite the junk files.
    assert.equal(report.decision, 'GRANTED');
  });

  it('reports an error when the artifact directory is absent', async () => {
    const { output, restore } = captureConsole();
    try {
      await new VerifyCommand().execute(aggregateCtx(tmpDir, 'does-not-exist'));
    } finally {
      restore();
    }
    assert.equal(process.exitCode, 1);
    assert.ok(output.errors.some((e) => e.includes('artifact directory not found')));
  });
});
