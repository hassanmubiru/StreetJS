import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';

import { CommandRunner } from '../src/verification/runner.js';
import {
  validateArtifact,
  type VerificationArtifact,
} from '../src/verification/artifact.js';
import type { BlockedReason } from '../src/verification/status.js';

// Feature: platform-leadership-gaps, Property 3: Produced artifacts are complete and atomically written
//
// Layer A — offline property test for the CommandRunner persistence path.
// Validates: Requirements 1.7, 1.11
//
//  (a) Every artifact produced — both by `CommandRunner.run()` and by the
//      `writeArtifactAtomic()` helper — passes `validateArtifact()` and carries
//      every required field (Req 1.7).
//  (b) Writes are atomic: at every induced write-failure point the write throws
//      and leaves NO partial artifact and NO leftover `*.tmp-*` file behind
//      (Req 1.11).

// ---- generators -------------------------------------------------------------

// A dotted capability id matching the artifact schema's `area.capability[.target]`.
const segmentArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 1,
    maxLength: 6,
  })
  .map((chars) => chars.join(''));
const capabilityIdArb = fc
  .array(segmentArb, { minLength: 2, maxLength: 4 })
  .map((parts) => parts.join('.'));

const evidenceArb = fc.record({
  sourceCode: fc.boolean(),
  passingTests: fc.boolean(),
  documentation: fc.boolean(),
  artifact: fc.boolean(),
});

const blockedReasonArb: fc.Arbitrary<BlockedReason> = fc.record({
  missingPrerequisite: fc.string({ minLength: 1 }),
  kind: fc.constantFrom<BlockedReason['kind']>(
    'service',
    'credential',
    'runtime',
    'timeout',
  ),
});

// A guaranteed schema-valid artifact (so a successful write+read round-trips clean).
const validArtifactArb: fc.Arbitrary<VerificationArtifact> = fc
  .record({
    capabilityId: capabilityIdArb,
    status: fc.constantFrom<VerificationArtifact['status']>(
      'VERIFIED',
      'PARTIAL',
      'BLOCKED',
      'NOT_IMPLEMENTED',
    ),
    evidence: evidenceArb,
    command: fc.string({ minLength: 1 }),
    exitCode: fc.integer({ min: -255, max: 255 }),
    timestamp: fc
      .date({
        min: new Date('2000-01-01T00:00:00.000Z'),
        max: new Date('2100-01-01T00:00:00.000Z'),
      })
      .map((d) => d.toISOString()),
    durationMs: fc.nat({ max: 600_000 }),
    timedOut: fc.boolean(),
    blockedReason: blockedReasonArb,
    generator: fc.record({
      tool: fc.string({ minLength: 1 }),
      version: fc.string({ minLength: 1 }),
    }),
  })
  .map((r): VerificationArtifact => {
    const base: VerificationArtifact = {
      schemaVersion: 1,
      capabilityId: r.capabilityId,
      status: r.status,
      evidence: r.evidence,
      command: r.command,
      exitCode: r.exitCode,
      timestamp: r.timestamp,
      durationMs: r.durationMs,
      timedOut: r.timedOut,
      generator: r.generator,
    };
    // The schema requires a blockedReason iff status is BLOCKED.
    if (r.status === 'BLOCKED') base.blockedReason = r.blockedReason;
    return base;
  });

const REQUIRED_FIELDS = [
  'schemaVersion',
  'capabilityId',
  'status',
  'evidence',
  'command',
  'exitCode',
  'timestamp',
  'generator',
] as const;

// ---- helpers ----------------------------------------------------------------

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'street-pbt-atomic-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Assert no leftover temp file (`*.tmp-*`) remains in the directory (Req 1.11). */
async function assertNoTempLeftover(dir: string): Promise<void> {
  const entries = await readdir(dir);
  const leftovers = entries.filter((e) => e.includes('.tmp-'));
  assert.deepEqual(
    leftovers,
    [],
    `expected no leftover temp files, found: ${leftovers.join(', ')}`,
  );
}

function assertCompleteAndValid(artifact: unknown): void {
  const result = validateArtifact(artifact);
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.ok(artifact && typeof artifact === 'object');
  const obj = artifact as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    assert.ok(field in obj, `produced artifact is missing required field '${field}'`);
  }
}

// ---- (a) completeness -------------------------------------------------------

describe('Property 3a: every artifact CommandRunner.run() produces is complete and valid (Req 1.7)', () => {
  it('writes a schema-valid artifact with all required fields for any run outcome', async () => {
    await fc.assert(
      fc.asyncProperty(
        capabilityIdArb,
        fc.integer({ min: 0, max: 5 }),
        fc.record(
          {
            sourceCode: fc.boolean(),
            passingTests: fc.boolean(),
            documentation: fc.boolean(),
            artifact: fc.boolean(),
          },
          { requiredKeys: [] },
        ),
        fc.boolean(),
        async (capabilityId, exitCode, evidenceHints, withPrereq) => {
          await withTempDir(async (dir) => {
            const runner = new CommandRunner();
            const prerequisites = withPrereq
              ? [
                  async (): Promise<BlockedReason | null> => ({
                    missingPrerequisite: 'svc',
                    kind: 'service',
                  }),
                ]
              : undefined;

            const { artifact, path } = await runner.run({
              capabilityId,
              // Shell builtin: exits immediately with the chosen code.
              command: `exit ${exitCode}`,
              evidenceHints,
              prerequisites,
              outDir: dir,
            });

            // The returned artifact is complete and valid.
            assertCompleteAndValid(artifact);

            // The persisted artifact on disk is complete and valid too.
            const onDisk = JSON.parse(await readFile(path, 'utf8'));
            assertCompleteAndValid(onDisk);
            assert.deepEqual(onDisk, JSON.parse(JSON.stringify(artifact)));

            // A clean, successful write leaves no temp file behind.
            await assertNoTempLeftover(dir);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 3b: writeArtifactAtomic persists complete, valid artifacts (Req 1.7)', () => {
  it('round-trips any schema-valid artifact byte-for-byte and leaves no temp file', async () => {
    await fc.assert(
      fc.asyncProperty(validArtifactArb, async (artifact) => {
        await withTempDir(async (dir) => {
          const path = join(dir, `${artifact.capabilityId}.artifact.json`);
          await CommandRunner.writeArtifactAtomic(path, artifact);

          const onDisk = JSON.parse(await readFile(path, 'utf8'));
          assertCompleteAndValid(onDisk);
          assert.deepEqual(onDisk, JSON.parse(JSON.stringify(artifact)));

          await assertNoTempLeftover(dir);
        });
      }),
      { numRuns: 100 },
    );
  });
});

// ---- (b) atomicity under induced write failures -----------------------------

describe('Property 3c: writeArtifactAtomic is atomic at every induced failure point (Req 1.11)', () => {
  it('throws and leaves no partial artifact / no leftover temp file when the write cannot complete', async () => {
    await fc.assert(
      fc.asyncProperty(
        validArtifactArb,
        // Two distinct induced write-failure points:
        //  - 'rename-onto-dir': the target path already exists as a directory,
        //    so the temp file is created but the final rename() fails.
        //  - 'parent-is-file': a path component is a regular file, so the
        //    directory for the artifact cannot be created at all.
        fc.constantFrom('rename-onto-dir', 'parent-is-file'),
        async (artifact, mode) => {
          await withTempDir(async (dir) => {
            let target: string;

            if (mode === 'rename-onto-dir') {
              target = join(dir, `${artifact.capabilityId}.artifact.json`);
              // Occupy the target path with a directory so rename() fails.
              await mkdir(target, { recursive: true });
            } else {
              const blocker = join(dir, 'blocker');
              await writeFile(blocker, 'not a directory', 'utf8');
              // A regular file sits where a directory must be ⇒ mkdir fails.
              target = join(blocker, 'nested', `${artifact.capabilityId}.artifact.json`);
            }

            await assert.rejects(
              CommandRunner.writeArtifactAtomic(target, artifact),
              'expected writeArtifactAtomic to reject at the induced failure point',
            );

            // No partial/leftover temp file in the output directory (Req 1.11).
            await assertNoTempLeftover(dir);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 3d: CommandRunner.run() surfaces write failure and leaves no partial artifact (Req 1.11)', () => {
  it('throws a capability-named error and leaves no leftover temp file when the artifact cannot be written', async () => {
    await fc.assert(
      fc.asyncProperty(capabilityIdArb, async (capabilityId) => {
        await withTempDir(async (dir) => {
          const runner = new CommandRunner();
          // Occupy the exact artifact path with a directory so the final
          // atomic rename cannot complete.
          const artifactPath = join(dir, `${capabilityId}.artifact.json`);
          await mkdir(artifactPath, { recursive: true });

          await assert.rejects(
            runner.run({
              capabilityId,
              command: 'exit 0',
              outDir: dir,
            }),
            (err: unknown) => {
              assert.ok(err instanceof Error);
              assert.ok(
                err.message.includes(capabilityId),
                'error should name the affected capability',
              );
              return true;
            },
          );

          await assertNoTempLeftover(dir);
        });
      }),
      { numRuns: 100 },
    );
  });
});
