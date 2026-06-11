// tests/upload-exif-strip-pbt.test.ts
// Property-based test for EXIF segment removal (Phase 4, R5.6).
//
// Feature: consumer-platform-security, Property 9: EXIF stripping removes all EXIF segments
// **Validates: Requirements 5.6**
//
// Requirement 5.6 demands that when an image upload is accepted in
// EXIF-stripping mode, the Upload_Guard produces a stored image whose output
// contains no EXIF metadata segments. EXIF metadata is carried in JPEG APP1
// (FF E1) segments. This file proves, across arbitrary valid JPEG byte streams
// that interleave EXIF APP1 segments with other header segments (APP0, APP2,
// COM, DQT, SOF0, DHT) and optional scan data:
//   1. `stripJpegExif` removes EVERY EXIF/APP1 segment from the header region —
//      none survives, regardless of how many were present or where they sat.
//   2. It preserves every NON-EXIF header segment, byte-for-byte and in order
//      (stripping is surgical, not lossy).
//   3. The result is still a structurally valid JPEG (begins with SOI) and, when
//      the input contained no 0xFF-bearing scan data, no FF E1 marker pair
//      survives anywhere in the output.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { stripJpegExif } from '../multipart/upload-guard.js';

const NUM_RUNS = 200;

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

// APP1 (FF E1) is where EXIF metadata lives.
const APP1 = 0xe1;
// Length-prefixed, non-standalone markers that are NOT APP1/SOS/EOI. These are
// the segments that MUST survive stripping untouched.
const OTHER_MARKERS = [0xe0, 0xe2, 0xed, 0xfe, 0xdb, 0xc0, 0xc4] as const;

interface Seg {
  marker: number;
  payload: Buffer;
  isExif: boolean;
}

/** Encode one length-prefixed JPEG segment: FF marker, 2-byte BE length, payload. */
function encodeSeg(marker: number, payload: Buffer): Buffer {
  const len = payload.length + 2; // length field includes its own 2 bytes
  return Buffer.concat([Buffer.from([0xff, marker, (len >> 8) & 0xff, len & 0xff]), payload]);
}

// ── Oracle ────────────────────────────────────────────────────────────────────
//
// Independently walk the JPEG header region (after SOI, up to the first SOS or
// EOI) and return the length-prefixed segments found there. This is the same
// contract the stripper operates over, expressed separately so the property
// compares two expressions of the JPEG segment grammar rather than the
// implementation against itself.
function parseHeaderSegments(buf: Buffer): { marker: number; payload: Buffer }[] {
  const segs: { marker: number; payload: Buffer }[] = [];
  let i = 2; // skip SOI
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS — header ends
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2; // standalone marker, no length
      continue;
    }
    if (i + 4 > buf.length) break;
    const len = buf.readUInt16BE(i + 2);
    const segEnd = i + 2 + len;
    if (segEnd > buf.length) break;
    segs.push({ marker, payload: Buffer.from(buf.subarray(i + 4, segEnd)) });
    i = segEnd;
  }
  return segs;
}

// ── Generators ──────────────────────────────────────────────────────────────
//
// An EXIF APP1 segment carries the canonical "Exif\0\0" identifier; the stripper
// removes ALL APP1 segments regardless of payload, so the identifier is included
// only for realism.
const exifSegArb: fc.Arbitrary<Seg> = fc
  .uint8Array({ maxLength: 48 })
  .map((tail) => ({
    marker: APP1,
    payload: Buffer.concat([Buffer.from('Exif\x00\x00', 'binary'), Buffer.from(tail)]),
    isExif: true,
  }));

const otherSegArb: fc.Arbitrary<Seg> = fc
  .record({
    marker: fc.constantFrom(...OTHER_MARKERS),
    payload: fc.uint8Array({ maxLength: 48 }).map((a) => Buffer.from(a)),
  })
  .map((r) => ({ marker: r.marker, payload: r.payload, isExif: false }));

// A mix biased to include EXIF segments often so the property exercises real
// stripping, while still allowing zero-EXIF inputs (stripping must be a no-op).
const segArb: fc.Arbitrary<Seg> = fc.oneof(
  { weight: 2, arbitrary: exifSegArb },
  { weight: 1, arbitrary: otherSegArb },
);

interface JpegCase {
  bytes: Buffer;
  segs: Seg[];
  scanHasFF: boolean;
}

const jpegArb: fc.Arbitrary<JpegCase> = fc
  .record({
    segs: fc.array(segArb, { maxLength: 10 }),
    withScan: fc.boolean(),
    // Scan/entropy bytes that exclude 0xFF so the output can be globally checked
    // for a surviving FF E1 marker pair without ambiguity.
    scan: fc.uint8Array({ maxLength: 40 }).map((a) => Buffer.from(a.map((b) => (b === 0xff ? 0x00 : b)))),
  })
  .map(({ segs, withScan, scan }) => {
    const parts: Buffer[] = [SOI, ...segs.map((s) => encodeSeg(s.marker, s.payload))];
    if (withScan) {
      // Minimal SOS segment, followed by opaque entropy-coded data the stripper
      // copies verbatim, then EOI.
      parts.push(encodeSeg(0xda, Buffer.from([0x00, 0x00])));
      parts.push(scan);
    }
    parts.push(EOI);
    return { bytes: Buffer.concat(parts), segs, scanHasFF: false };
  });

describe('Property 9: EXIF stripping removes all EXIF segments', () => {
  it('removes every APP1/EXIF segment while preserving all other header segments byte-for-byte', () => {
    fc.assert(
      fc.property(jpegArb, ({ bytes, segs }) => {
        const out = stripJpegExif(bytes);

        // Output remains a structurally valid JPEG (begins with SOI).
        assert.equal(out[0], 0xff);
        assert.equal(out[1], 0xd8);

        const outSegs = parseHeaderSegments(out);

        // (1) No EXIF metadata segment survives in the header region (R5.6).
        assert.ok(
          outSegs.every((s) => s.marker !== APP1),
          'an APP1/EXIF segment survived stripping',
        );

        // (2) Every non-EXIF header segment is preserved, in order, byte-for-byte.
        const expected = segs.filter((s) => !s.isExif);
        assert.equal(outSegs.length, expected.length);
        outSegs.forEach((s, idx) => {
          assert.equal(s.marker, expected[idx].marker);
          assert.deepEqual(s.payload, expected[idx].payload);
        });

        // (3) Since scan data excludes 0xFF, no FF E1 marker pair survives
        // ANYWHERE in the output — a strong global guarantee of EXIF removal.
        for (let i = 0; i + 1 < out.length; i++) {
          assert.ok(
            !(out[i] === 0xff && out[i + 1] === APP1),
            `a residual FF E1 (EXIF) marker pair was found at offset ${i}`,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
