// tests/upload-type-enforcement-pbt.test.ts
// Property-based test for the Upload_Guard (Phase 4, Requirement 5).
//
// Feature: consumer-platform-security, Property 8 — Upload type enforcement
// from magic bytes.
// Validates: Requirements 5.3, 5.4, 5.5
//
// This file proves, across arbitrary file formats, trailing content, and
// declared MIME types, that the guard enforces a file's *true* format derived
// from its Magic_Byte_Signature rather than trusting the client:
//   1. True-format detection (R5.3): for every supported signature, the leading
//      bytes alone determine the detected MIME type, independent of trailing
//      content or the declared MIME type.
//   2. Declared-vs-true match (R5.4): when the declared MIME type equals the
//      detected type the upload is accepted; when it differs — or when the true
//      format cannot be determined — the upload is rejected with HTTP 415 and
//      the temp file is not persisted (fail closed).
//   3. Image-only mode (R5.5): with image-only mode enabled, a non-image true
//      format is rejected with HTTP 415 and not persisted, while an allowed
//      image format is accepted.
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

// ── Supported magic-byte signatures the guard recognizes ────────────────────────
interface Format {
  readonly name: string;
  readonly mime: string;
  readonly head: Buffer;
  readonly isImage: boolean;
}

const FORMATS: readonly Format[] = [
  { name: 'jpeg', mime: 'image/jpeg', head: Buffer.from([0xff, 0xd8, 0xff]), isImage: true },
  {
    name: 'png',
    mime: 'image/png',
    head: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    isImage: true,
  },
  { name: 'gif', mime: 'image/gif', head: Buffer.from([0x47, 0x49, 0x46, 0x38]), isImage: true },
  { name: 'pdf', mime: 'application/pdf', head: Buffer.from([0x25, 0x50, 0x44, 0x46]), isImage: false },
];

// First bytes of every supported signature. A leading byte outside this set is
// guaranteed not to match any known format.
const MAGIC_FIRST_BYTES = new Set(FORMATS.map((f) => f.head[0]));

// Generous cap so type enforcement — not the size gate — is what is exercised.
const MAX_BYTES = 1 << 20;

// ── Temp-file scaffolding ───────────────────────────────────────────────────────
let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'upload-type-pbt-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeTemp(bytes: Buffer): Promise<string> {
  const p = join(dir, randomBytes(12).toString('hex'));
  await writeFile(p, bytes);
  return p;
}

function parsedFile(path: string, bytes: Buffer, mimeType: string): ParsedFile {
  // The client-supplied originalName is deliberately hostile to confirm it is
  // never trusted for type decisions.
  return { fieldName: 'file', originalName: '../../client.bin', mimeType, size: bytes.length, path, encoding: '7bit' };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// ── Generators ────────────────────────────────────────────────────────────────
const formatArb = fc.constantFrom(...FORMATS);
const tailArb = fc.uint8Array({ maxLength: 128 }).map((u) => Buffer.from(u));
// A leading byte that cannot begin any supported signature.
const nonMagicFirstByte = fc.integer({ min: 0, max: 255 }).filter((b) => !MAGIC_FIRST_BYTES.has(b));

// ── Property 8a: true-format detection from magic bytes (R5.3) ──────────────────

// Feature: consumer-platform-security, Property 8: Upload type enforcement from magic bytes
// Validates: Requirements 5.3
describe('Property 8: true file format is detected from magic bytes', () => {
  it('maps each supported signature to its canonical MIME type regardless of trailing content (R5.3)', () => {
    const guard = new UploadGuard({ maxBytes: MAX_BYTES });
    fc.assert(
      fc.property(formatArb, tailArb, (fmt, tail) => {
        const head = Buffer.concat([fmt.head, tail]);
        assert.deepEqual(guard.detectFormat(head), { mime: fmt.mime });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('detects no format for heads that match no known signature (R5.3)', () => {
    const guard = new UploadGuard({ maxBytes: MAX_BYTES });
    fc.assert(
      fc.property(nonMagicFirstByte, tailArb, (first, tail) => {
        const head = Buffer.concat([Buffer.from([first]), tail]);
        assert.equal(guard.detectFormat(head.subarray(0, 12)), null);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ── Property 8b: declared-vs-true MIME match enforcement (R5.4) ─────────────────

// Feature: consumer-platform-security, Property 8: Upload type enforcement from magic bytes
// Validates: Requirements 5.4
describe('Property 8: declared MIME type must match the true format', () => {
  it('accepts when declared equals detected and rejects 415 (unlinking) otherwise (R5.4)', async () => {
    await fc.assert(
      fc.asyncProperty(formatArb, formatArb, tailArb, async (trueFmt, declaredFmt, tail) => {
        const bytes = Buffer.concat([trueFmt.head, tail]);
        const p = await writeTemp(bytes);
        const guard = new UploadGuard({ maxBytes: MAX_BYTES });
        const file = parsedFile(p, bytes, declaredFmt.mime);

        if (declaredFmt.mime === trueFmt.mime) {
          const { accepted } = await guard.guard(file);
          assert.equal(accepted.detectedMime, trueFmt.mime);
        } else {
          await assert.rejects(
            () => guard.guard(file),
            (e: UploadRejected) =>
              e instanceof UploadRejected && e.status === 415 && e.code === 'MIME_MISMATCH',
          );
          assert.equal(await exists(p), false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects 415 (unlinking) when the true format cannot be determined (R5.4 fail-closed)', async () => {
    await fc.assert(
      fc.asyncProperty(nonMagicFirstByte, tailArb, formatArb, async (first, tail, declared) => {
        const bytes = Buffer.concat([Buffer.from([first]), tail]);
        const p = await writeTemp(bytes);
        const guard = new UploadGuard({ maxBytes: MAX_BYTES });

        await assert.rejects(
          () => guard.guard(parsedFile(p, bytes, declared.mime)),
          (e: UploadRejected) => e instanceof UploadRejected && e.status === 415,
        );
        assert.equal(await exists(p), false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ── Property 8c: image-only mode rejects non-image signatures (R5.5) ────────────

// Feature: consumer-platform-security, Property 8: Upload type enforcement from magic bytes
// Validates: Requirements 5.5
describe('Property 8: image-only mode enforces allowed image formats', () => {
  it('accepts image signatures and rejects non-image signatures 415 (unlinking) (R5.5)', async () => {
    await fc.assert(
      fc.asyncProperty(formatArb, tailArb, async (fmt, tail) => {
        const bytes = Buffer.concat([fmt.head, tail]);
        const p = await writeTemp(bytes);
        const guard = new UploadGuard({ maxBytes: MAX_BYTES, imageOnly: true });
        // Declared type matches the true type so only the image-only gate decides.
        const file = parsedFile(p, bytes, fmt.mime);

        if (fmt.isImage) {
          const { accepted } = await guard.guard(file);
          assert.equal(accepted.detectedMime, fmt.mime);
        } else {
          await assert.rejects(
            () => guard.guard(file),
            (e: UploadRejected) =>
              e instanceof UploadRejected && e.status === 415 && e.code === 'DISALLOWED_TYPE',
          );
          assert.equal(await exists(p), false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
