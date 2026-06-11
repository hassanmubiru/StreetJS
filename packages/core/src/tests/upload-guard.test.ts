// tests/upload-guard.test.ts
// Example-based unit tests for the Upload_Guard (Phase 4, R5). The named
// property tests for size/MIME/image-only/EXIF/malware live in their own tasks;
// these verify the core implementation behaviors with concrete examples.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UploadGuard, UploadRejected, stripJpegExif } from '../multipart/upload-guard.js';
import type { ParsedFile } from '../multipart/parser.js';

// Minimal valid magic-byte heads for each supported format.
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF_HEAD = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const PDF_HEAD = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'upload-guard-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeTemp(name: string, bytes: Buffer): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, bytes);
  return p;
}

function parsedFile(path: string, bytes: Buffer, mimeType: string, originalName = 'client.bin'): ParsedFile {
  return { fieldName: 'file', originalName, mimeType, size: bytes.length, path, encoding: '7bit' };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('UploadGuard.detectFormat', () => {
  const guard = new UploadGuard({ maxBytes: 1024 });

  it('detects JPEG, PNG, GIF and PDF from magic bytes', () => {
    assert.deepEqual(guard.detectFormat(JPEG_HEAD), { mime: 'image/jpeg' });
    assert.deepEqual(guard.detectFormat(PNG_HEAD), { mime: 'image/png' });
    assert.deepEqual(guard.detectFormat(GIF_HEAD), { mime: 'image/gif' });
    assert.deepEqual(guard.detectFormat(PDF_HEAD), { mime: 'application/pdf' });
  });

  it('returns null for unknown signatures', () => {
    assert.equal(guard.detectFormat(Buffer.from([0x00, 0x01, 0x02, 0x03])), null);
  });
});

describe('UploadGuard.guard', () => {
  it('accepts a matching file and assigns a secure stored name (R5.9)', async () => {
    const bytes = Buffer.concat([PNG_HEAD, Buffer.alloc(16)]);
    const p = await writeTemp('a.png', bytes);
    const guard = new UploadGuard({ maxBytes: 1024 });
    const { accepted } = await guard.guard(parsedFile(p, bytes, 'image/png', '../../evil.png'));

    assert.equal(accepted.detectedMime, 'image/png');
    assert.match(accepted.storedName, /^[0-9a-f]{32}\.png$/);
    assert.ok(!accepted.storedName.includes('/') && !accepted.storedName.includes('\\'));
    assert.ok(!accepted.storedName.includes('evil'));
  });

  it('rejects oversize files with 413 and unlinks the temp file (R5.2)', async () => {
    const bytes = Buffer.concat([PNG_HEAD, Buffer.alloc(64)]);
    const p = await writeTemp('big.png', bytes);
    const guard = new UploadGuard({ maxBytes: 8 });
    await assert.rejects(
      () => guard.guard(parsedFile(p, bytes, 'image/png')),
      (e: UploadRejected) => e instanceof UploadRejected && e.status === 413 && e.code === 'TOO_LARGE',
    );
    assert.equal(await exists(p), false);
  });

  it('rejects declared-vs-true MIME mismatch with 415 (R5.4)', async () => {
    const bytes = Buffer.concat([PNG_HEAD, Buffer.alloc(8)]);
    const p = await writeTemp('lie.jpg', bytes);
    const guard = new UploadGuard({ maxBytes: 1024 });
    await assert.rejects(
      () => guard.guard(parsedFile(p, bytes, 'image/jpeg')),
      (e: UploadRejected) => e.status === 415 && e.code === 'MIME_MISMATCH',
    );
    assert.equal(await exists(p), false);
  });

  it('rejects non-images in image-only mode with 415 (R5.5)', async () => {
    const bytes = Buffer.concat([PDF_HEAD, Buffer.alloc(8)]);
    const p = await writeTemp('doc.pdf', bytes);
    const guard = new UploadGuard({ maxBytes: 1024, imageOnly: true });
    await assert.rejects(
      () => guard.guard(parsedFile(p, bytes, 'application/pdf')),
      (e: UploadRejected) => e.status === 415 && e.code === 'DISALLOWED_TYPE',
    );
    assert.equal(await exists(p), false);
  });

  it('invokes the malware hook before persistence and rejects malicious files (R5.7/R5.8)', async () => {
    const bytes = Buffer.concat([PNG_HEAD, Buffer.alloc(8)]);
    const p = await writeTemp('m.png', bytes);
    let called = false;
    const guard = new UploadGuard({
      maxBytes: 1024,
      malwareScan: async () => {
        called = true;
        return { malicious: true, reason: 'eicar' };
      },
    });
    await assert.rejects(
      () => guard.guard(parsedFile(p, bytes, 'image/png')),
      (e: UploadRejected) => e.status === 415 && e.code === 'MALWARE',
    );
    assert.equal(called, true);
    assert.equal(await exists(p), false);
  });

  it('fails closed when the malware hook throws (R5.8)', async () => {
    const bytes = Buffer.concat([PNG_HEAD, Buffer.alloc(8)]);
    const p = await writeTemp('m2.png', bytes);
    const guard = new UploadGuard({
      maxBytes: 1024,
      malwareScan: async () => {
        throw new Error('scanner offline');
      },
    });
    await assert.rejects(
      () => guard.guard(parsedFile(p, bytes, 'image/png')),
      (e: UploadRejected) => e.code === 'MALWARE',
    );
    assert.equal(await exists(p), false);
  });

  it('strips EXIF (APP1) from accepted JPEGs (R5.6)', async () => {
    // SOI + APP1(EXIF) + a benign COM segment + EOI
    const app1 = Buffer.concat([
      Buffer.from([0xff, 0xe1, 0x00, 0x10]), // APP1, length 16 (incl. length bytes)
      Buffer.from('Exif\x00\x00', 'binary'),
      Buffer.alloc(8),
    ]);
    const com = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x04]), Buffer.from([0x41, 0x42])]);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), // SOI + APP0 stub
      app1,
      com,
      Buffer.from([0xff, 0xd9]), // EOI
    ]);
    const p = await writeTemp('exif.jpg', jpeg);
    const guard = new UploadGuard({ maxBytes: 4096, stripExif: true });
    const { accepted } = await guard.guard(parsedFile(p, jpeg, 'image/jpeg'));

    const out = await readFile(accepted.path);
    // No APP1 marker remains.
    assert.equal(indexOfMarker(out, 0xe1), -1);
    // Still a valid JPEG and the benign COM segment is preserved.
    assert.equal(out[0], 0xff);
    assert.equal(out[1], 0xd8);
    assert.notEqual(indexOfMarker(out, 0xfe), -1);
    assert.equal(accepted.size, out.length);
  });
});

describe('stripJpegExif', () => {
  it('returns non-JPEG input unchanged', () => {
    const png = Buffer.concat([PNG_HEAD, Buffer.alloc(4)]);
    assert.deepEqual(stripJpegExif(png), png);
  });
});

function indexOfMarker(buf: Buffer, marker: number): number {
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === 0xff && buf[i + 1] === marker) return i;
  }
  return -1;
}
