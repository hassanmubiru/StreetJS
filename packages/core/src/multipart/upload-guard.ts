// src/multipart/upload-guard.ts
// Upload_Guard (Phase 4, R5): a post-parse validation layer that consumes the
// ParsedFile[] produced by MultipartParser and enforces upload security policy:
//   - size cap (R5.2)
//   - true-format detection via magic bytes (R5.3)
//   - declared-vs-true MIME match (R5.4)
//   - image-only mode (R5.5)
//   - EXIF stripping for stored images (R5.6)
//   - malware-scan hook invoked before persistence, fail-closed (R5.7/R5.8)
//   - secure stored filename with no path separators or client filename (R5.9)
//
// It builds on multipart/parser.ts (R5.1) rather than introducing a separate
// upload parser: it operates on the temp files that the parser already streamed
// to disk, unlinking them on rejection so a rejected upload is never persisted.

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { ParsedFile } from './parser.js';

/** Policy controlling how an upload is validated. */
export interface UploadPolicy {
  /** Maximum accepted file size in bytes (R5.2). */
  maxBytes: number;
  /** When true, only allowed image formats are accepted (R5.5). */
  imageOnly?: boolean;
  /**
   * If provided, the detected (true) MIME type MUST be a member of this set
   * (R5.4 declared-vs-true match set). When omitted, only the declared-vs-true
   * equality check applies.
   */
  allowedMimeTypes?: string[];
  /** When true, EXIF metadata is stripped from accepted images (R5.6). */
  stripExif?: boolean;
  /**
   * Malware-scan hook invoked for each otherwise-accepted file BEFORE it is
   * considered persisted (R5.7). A malicious verdict — or a hook that throws —
   * rejects the upload (fail-closed, R5.8).
   */
  malwareScan?: (file: ParsedFile) => Promise<{ malicious: boolean; reason?: string }>;
}

/** A file that passed every policy check. */
export interface UploadGuardResult {
  accepted: ParsedFile & { detectedMime: string; storedName: string };
}

/** Why an upload was rejected. */
export type UploadRejectionCode =
  | 'TOO_LARGE'
  | 'MIME_MISMATCH'
  | 'DISALLOWED_TYPE'
  | 'MALWARE';

/** Error thrown when an upload fails policy. Carries the HTTP status to return. */
export class UploadRejected extends Error {
  /** 413 for size rejection; 415 for type/mime/image-only/malware rejection. */
  readonly status: 413 | 415;
  readonly code: UploadRejectionCode;

  constructor(code: UploadRejectionCode, message: string) {
    super(message);
    this.name = 'UploadRejected';
    this.code = code;
    this.status = code === 'TOO_LARGE' ? 413 : 415;
    Object.setPrototypeOf(this, UploadRejected.prototype);
  }
}

/** Detected formats and the canonical MIME type they map to. */
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif']);

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

/** Number of leading bytes needed to identify every supported signature. */
const MAGIC_BYTE_HEAD = 12;

export class UploadGuard {
  private readonly policy: UploadPolicy;

  constructor(policy: UploadPolicy) {
    this.policy = policy;
  }

  /**
   * Determine a file's true format from its Magic_Byte_Signature (R5.3),
   * independent of declared MIME type or filename. Returns null when the head
   * matches no supported signature.
   */
  detectFormat(head: Buffer): { mime: string } | null {
    // JPEG: FF D8 FF
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
      return { mime: 'image/jpeg' };
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      head.length >= 8 &&
      head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
      head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
    ) {
      return { mime: 'image/png' };
    }
    // GIF: 47 49 46 38 ("GIF8")
    if (
      head.length >= 4 &&
      head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38
    ) {
      return { mime: 'image/gif' };
    }
    // PDF: 25 50 44 46 ("%PDF")
    if (
      head.length >= 4 &&
      head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46
    ) {
      return { mime: 'application/pdf' };
    }
    return null;
  }

  /**
   * Validate one parsed file against the policy. On any failure, the temp file
   * left by the parser is unlinked (so a rejected upload is never persisted)
   * and an UploadRejected error is thrown. On success, returns the accepted
   * file annotated with its detected MIME type and a secure stored name.
   */
  async guard(file: ParsedFile): Promise<UploadGuardResult> {
    // R5.2 — size cap. Reject 413 and do not persist.
    if (file.size > this.policy.maxBytes) {
      await this.discard(file);
      throw new UploadRejected(
        'TOO_LARGE',
        `File exceeds maximum size of ${this.policy.maxBytes} bytes`,
      );
    }

    let contents: Buffer;
    try {
      contents = await readFile(file.path);
    } catch (err) {
      // Cannot read the temp file — fail closed.
      await this.discard(file);
      throw new UploadRejected(
        'MIME_MISMATCH',
        `Unable to read uploaded file: ${(err as Error).message}`,
      );
    }

    const head = contents.subarray(0, MAGIC_BYTE_HEAD);
    const detected = this.detectFormat(head);

    // R5.5 — image-only mode: a non-image (or unknown) signature is rejected 415.
    if (this.policy.imageOnly) {
      if (detected === null || !IMAGE_MIME_TYPES.has(detected.mime)) {
        await this.discard(file);
        throw new UploadRejected(
          'DISALLOWED_TYPE',
          'Only image uploads are permitted',
        );
      }
    }

    // R5.4 — declared-vs-true MIME match. An unknown true format cannot be
    // verified against the declared type, so it is rejected (fail closed).
    if (detected === null) {
      await this.discard(file);
      throw new UploadRejected(
        'MIME_MISMATCH',
        'Could not determine the true file format from its contents',
      );
    }
    if (detected.mime !== file.mimeType) {
      await this.discard(file);
      throw new UploadRejected(
        'MIME_MISMATCH',
        `Declared MIME type "${file.mimeType}" does not match detected type "${detected.mime}"`,
      );
    }

    // R5.4 — restrict to an explicit allow-list when configured.
    if (this.policy.allowedMimeTypes && !this.policy.allowedMimeTypes.includes(detected.mime)) {
      await this.discard(file);
      throw new UploadRejected(
        'DISALLOWED_TYPE',
        `MIME type "${detected.mime}" is not allowed`,
      );
    }

    // R5.7/R5.8 — malware-scan hook BEFORE persistence; fail closed.
    if (this.policy.malwareScan) {
      let verdict: { malicious: boolean; reason?: string };
      try {
        verdict = await this.policy.malwareScan(file);
      } catch (err) {
        await this.discard(file);
        throw new UploadRejected(
          'MALWARE',
          `Malware scan failed: ${(err as Error).message}`,
        );
      }
      if (verdict.malicious) {
        await this.discard(file);
        throw new UploadRejected(
          'MALWARE',
          verdict.reason ?? 'File flagged as malicious by malware scan',
        );
      }
    }

    // R5.6 — strip EXIF from accepted images when enabled.
    if (this.policy.stripExif && detected.mime === 'image/jpeg') {
      const stripped = stripJpegExif(contents);
      await writeFile(file.path, stripped);
      file = { ...file, size: stripped.length };
    }

    // R5.9 — secure stored filename: random, no path separators, no client name.
    const storedName = randomBytes(16).toString('hex') + (MIME_EXTENSION[detected.mime] ?? '');

    return {
      accepted: { ...file, detectedMime: detected.mime, storedName },
    };
  }

  /** Remove the parser's temp file; swallow errors so rejection still surfaces. */
  private async discard(file: ParsedFile): Promise<void> {
    try {
      await unlink(file.path);
    } catch {
      // File may already be gone; nothing more to do.
    }
  }
}

/**
 * Remove EXIF (APP1) metadata segments from a JPEG byte stream (R5.6). The
 * output is a valid JPEG containing no EXIF metadata. Non-JPEG input is
 * returned unchanged.
 */
export function stripJpegExif(buf: Buffer): Buffer {
  // Must start with SOI (FF D8).
  if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;

  const out: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let i = 2;

  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) {
      // Not a marker boundary — copy the remainder verbatim.
      out.push(buf.subarray(i));
      i = buf.length;
      break;
    }

    const marker = buf[i + 1];

    // EOI — copy and stop.
    if (marker === 0xd9) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      break;
    }

    // SOS — start of compressed scan data; copy the rest verbatim.
    if (marker === 0xda) {
      out.push(buf.subarray(i));
      i = buf.length;
      break;
    }

    // Standalone markers without a length field (RSTn, TEM).
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push(buf.subarray(i, i + 2));
      i += 2;
      continue;
    }

    // Length-prefixed segment. Length includes the two length bytes.
    if (i + 4 > buf.length) {
      out.push(buf.subarray(i));
      break;
    }
    const len = buf.readUInt16BE(i + 2);
    const segEnd = i + 2 + len;
    if (segEnd > buf.length) {
      // Malformed length — copy the remainder verbatim to avoid corruption.
      out.push(buf.subarray(i));
      i = buf.length;
      break;
    }

    // Drop APP1 (FF E1) segments — these carry EXIF metadata.
    if (marker !== 0xe1) {
      out.push(buf.subarray(i, segEnd));
    }
    i = segEnd;
  }

  return Buffer.concat(out);
}
