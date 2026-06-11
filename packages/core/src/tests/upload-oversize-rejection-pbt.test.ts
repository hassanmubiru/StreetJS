// tests/upload-oversize-rejection-pbt.test.ts
// Property-based test for the Upload_Guard (Phase 4, Requirement 5).
//
// Feature: consumer-platform-security, Property 7 — Oversize uploads are
// rejected and not persisted.
// Validates: Requirements 5.2
//
// This file proves, across arbitrary file contents and size/limit
// combinations, that the guard's size gate behaves exactly as R5.2 demands:
//   - WHEN an uploaded file's reported size exceeds the configured maximum,
//     THE guard rejects the upload with HTTP status 413 (code TOO_LARGE) and
//     SHALL NOT persist the file — the temp file the parser streamed to disk
//     is unlinked so nothing is left behind.
//   - The size gate is evaluated FIRST (before reading/format detection), so a
//     file over the cap is rejected purely on size regardless of its contents.
//   - Conversely, a file at or below the cap clears the size gate (it is not
//     rejected with 413 / TOO_LARGE).
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is exercised across many generated inputs alongside the
// example/edge-case unit tests in upload-guard.test.ts.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { UploadGuard, UploadRejected } from '../multipart/upload-guard.js';
import type { ParsedFile } from '../multipart/parser.js';

const NUM_RUNS = 100;

// ── Temp-file scaffolding ───────────────────────────────────────────────────────
let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'upload-oversize-pbt-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeTemp(bytes: Buffer): Promise<string> {
  const p = join(dir, randomBytes(12).toString('hex'));
  await writeFile(p, bytes);
  return p;
}

/**
 * Build a ParsedFile whose reported `size` matches the bytes on disk. The
 * client-supplied originalName is deliberately hostile to confirm it plays no
 * role in the size decision.
 */
function parsedFile(path: string, bytes: Buffer, mimeType: string): ParsedFile {
  return {
    fieldName: 'file',
    originalName: '../../client.bin',
    mimeType,
    size: bytes.length,
    path,
    encoding: '7bit',
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// A JPEG payload of an exact length: valid magic header + filler tail so that,
// when the file is within the size cap, only the size gate (not type
// enforcement) is under test.
function jpegOfLength(len: number): Buffer {
  const head = Buffer.from([0xff, 0xd8, 0xff]);
  if (len <= head.length) return head.subarray(0, Math.max(0, len));
  return Buffer.concat([head, Buffer.alloc(len - head.length, 0x20)]);
}

// ── Property 7a: oversize files are rejected 413 and never persisted ────────────

// Feature: consumer-platform-security, Property 7: Oversize uploads are rejected and not persisted
// Validates: Requirements 5.2
describe('Property 7: oversize uploads are rejected and not persisted', () => {
  it('rejects with HTTP 413 (TOO_LARGE) and unlinks the temp file whenever size exceeds the cap (R5.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A positive maximum, and an overage of at least one byte beyond it.
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        // Arbitrary leading byte so contents (and whether they look like a known
        // format) cannot influence the size decision.
        fc.integer({ min: 0, max: 255 }),
        async (maxBytes, overage, firstByte) => {
          const size = maxBytes + overage; // strictly greater than the cap
          const bytes = Buffer.concat([Buffer.from([firstByte]), Buffer.alloc(size - 1, 0x41)]);
          const p = await writeTemp(bytes);
          const guard = new UploadGuard({ maxBytes });

          await assert.rejects(
            () => guard.guard(parsedFile(p, bytes, 'image/jpeg')),
            (e: UploadRejected) =>
              e instanceof UploadRejected && e.status === 413 && e.code === 'TOO_LARGE',
          );

          // R5.2: the upload must not be persisted — the temp file is gone.
          assert.equal(await exists(p), false);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ── Property 7b: files within the cap clear the size gate ─────────────────────
  it('does not reject on size (413/TOO_LARGE) when the file is at or below the cap (R5.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 3, max: 4096 }),
        // headroom in [0, maxBytes-3]; size = maxBytes - headroom ∈ [3, maxBytes].
        fc.nat(),
        async (maxBytes, rawHeadroom) => {
          const headroom = rawHeadroom % (maxBytes - 2); // 0..maxBytes-3
          const size = maxBytes - headroom; // 3..maxBytes (always <= cap)
          const bytes = jpegOfLength(size);
          const p = await writeTemp(bytes);
          const guard = new UploadGuard({ maxBytes });

          // A within-cap, type-consistent JPEG must pass the size gate and be
          // accepted; in particular it must never be a 413/TOO_LARGE rejection.
          try {
            const { accepted } = await guard.guard(parsedFile(p, bytes, 'image/jpeg'));
            assert.equal(accepted.detectedMime, 'image/jpeg');
          } catch (e) {
            assert.ok(
              !(e instanceof UploadRejected && e.code === 'TOO_LARGE'),
              'within-cap file must not be rejected for size',
            );
            throw e;
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
