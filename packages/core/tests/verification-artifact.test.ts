import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateArtifact,
  type VerificationArtifact,
} from '../src/verification/artifact.js';

// A minimal, schema-valid artifact used as the base for mutation tests.
function validBase(): VerificationArtifact {
  return {
    schemaVersion: 1,
    capabilityId: 'cloud.deploy.kubernetes',
    status: 'VERIFIED',
    evidence: {
      sourceCode: true,
      passingTests: true,
      documentation: true,
      artifact: true,
    },
    command: 'npm run verify:cloud',
    exitCode: 0,
    timestamp: '2025-01-01T00:00:00.000Z',
    durationMs: 1234,
    timedOut: false,
    generator: { tool: 'street-verify', version: '1.0.0' },
  };
}

describe('validateArtifact — required fields (Req 1.7)', () => {
  it('accepts a fully populated, well-formed artifact', () => {
    const result = validateArtifact(validBase());
    assert.equal(result.valid, true, result.errors.join('; '));
    assert.deepEqual(result.errors, []);
  });

  it('records each missing required field', () => {
    for (const field of [
      'schemaVersion',
      'capabilityId',
      'status',
      'evidence',
      'command',
      'exitCode',
      'timestamp',
      'generator',
    ] as const) {
      const a = validBase() as Record<string, unknown>;
      delete a[field];
      const result = validateArtifact(a);
      assert.equal(result.valid, false, `expected ${field} to be required`);
      assert.ok(
        result.errors.some((e) => e.startsWith(`${field}:`)),
        `expected an error for missing ${field}, got: ${result.errors.join('; ')}`,
      );
    }
  });

  it('rejects non-object inputs', () => {
    for (const bad of [null, undefined, 42, 'x', [], true]) {
      assert.equal(validateArtifact(bad).valid, false);
    }
  });

  it('rejects unknown top-level properties (additionalProperties: false)', () => {
    const a = { ...validBase(), surprise: 1 };
    const result = validateArtifact(a);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.startsWith('surprise:')));
  });
});

describe('validateArtifact — field constraints', () => {
  it('requires schemaVersion to be the constant 1', () => {
    const a = { ...validBase(), schemaVersion: 2 };
    assert.equal(validateArtifact(a).valid, false);
  });

  it('enforces the dotted capabilityId pattern', () => {
    for (const bad of ['nodot', 'UPPER.case', 'has space.x', '.leading', 'trailing.']) {
      const a = { ...validBase(), capabilityId: bad };
      assert.equal(validateArtifact(a).valid, false, `expected ${bad} to be invalid`);
    }
    for (const good of ['a.b', 'cloud.deploy.kubernetes', 'kafka.chaos.broker-restart']) {
      const a = { ...validBase(), capabilityId: good };
      assert.equal(validateArtifact(a).valid, true, `expected ${good} to be valid`);
    }
  });

  it('restricts status to the four enum values', () => {
    for (const bad of ['verified', 'OK', 'DONE', '']) {
      const a = { ...validBase(), status: bad };
      assert.equal(validateArtifact(a).valid, false);
    }
    for (const good of ['VERIFIED', 'PARTIAL', 'NOT_IMPLEMENTED']) {
      const a = { ...validBase(), status: good };
      assert.equal(validateArtifact(a).valid, true, good);
    }
  });

  it('requires all four boolean evidence components', () => {
    const a = validBase();
    (a.evidence as Record<string, unknown>).passingTests = 'yes';
    assert.equal(validateArtifact(a).valid, false);

    const b = validBase();
    delete (b.evidence as Record<string, unknown>).documentation;
    assert.equal(validateArtifact(b).valid, false);
  });

  it('requires a non-empty command string', () => {
    assert.equal(validateArtifact({ ...validBase(), command: '' }).valid, false);
    assert.equal(validateArtifact({ ...validBase(), command: 123 }).valid, false);
  });

  it('requires an integer exitCode', () => {
    assert.equal(validateArtifact({ ...validBase(), exitCode: 1.5 }).valid, false);
    assert.equal(validateArtifact({ ...validBase(), exitCode: '0' }).valid, false);
    assert.equal(validateArtifact({ ...validBase(), exitCode: -1 }).valid, true);
  });

  it('requires an ISO-8601 date-time timestamp', () => {
    for (const bad of ['2025-01-01', 'not-a-date', '01/01/2025', '']) {
      assert.equal(
        validateArtifact({ ...validBase(), timestamp: bad }).valid,
        false,
        `expected ${bad} to be invalid`,
      );
    }
    for (const good of ['2025-01-01T00:00:00Z', '2025-06-15T12:30:45.123+02:00']) {
      assert.equal(
        validateArtifact({ ...validBase(), timestamp: good }).valid,
        true,
        good,
      );
    }
  });

  it('rejects a negative durationMs', () => {
    assert.equal(validateArtifact({ ...validBase(), durationMs: -1 }).valid, false);
  });
});

describe('validateArtifact — generator marks command-produced artifacts (Req 1.8)', () => {
  it('rejects an artifact missing the generator field', () => {
    const a = validBase() as Record<string, unknown>;
    delete a.generator;
    const result = validateArtifact(a);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.startsWith('generator:')));
  });

  it('requires generator.tool and generator.version to be strings', () => {
    assert.equal(
      validateArtifact({ ...validBase(), generator: { tool: 'x' } }).valid,
      false,
    );
    assert.equal(
      validateArtifact({ ...validBase(), generator: { tool: 1, version: '1' } }).valid,
      false,
    );
  });
});

describe('validateArtifact — BLOCKED requires blockedReason', () => {
  it('rejects BLOCKED without a blockedReason', () => {
    const a = { ...validBase(), status: 'BLOCKED' as const };
    const result = validateArtifact(a);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('blockedReason')));
  });

  it('accepts BLOCKED with a well-formed blockedReason', () => {
    const a: VerificationArtifact = {
      ...validBase(),
      status: 'BLOCKED',
      blockedReason: { missingPrerequisite: 'kubectl', kind: 'runtime' },
    };
    assert.equal(validateArtifact(a).valid, true, validateArtifact(a).errors.join('; '));
  });

  it('rejects a malformed blockedReason', () => {
    const a = {
      ...validBase(),
      status: 'BLOCKED' as const,
      blockedReason: { missingPrerequisite: '', kind: 'nope' },
    };
    assert.equal(validateArtifact(a).valid, false);
  });
});
