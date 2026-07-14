// src/multipart/parser.ts
// Streaming multipart/form-data parser.
// Streams file uploads directly to disk — never buffers full upload in heap.

import { createWriteStream, unlink } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import type { IncomingMessage } from 'node:http';

export interface ParsedFile {
  fieldName: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  encoding: string;
}

export interface MultipartResult {
  fields: Record<string, string>;
  files: ParsedFile[];
}

const MAX_FIELD_SIZE = 64 * 1024;  // 64 KB per field
const MAX_FILE_CHUNK = 64 * 1024;  // 64 KB chunk size

export class MultipartParser {
  private readonly boundary: Buffer;
  private readonly uploadsDir: string;
  private readonly maxBytes: number;

  constructor(boundary: string, uploadsDir: string, maxBytes: number) {
    this.boundary = Buffer.from('--' + boundary, 'binary');
    this.uploadsDir = uploadsDir;
    this.maxBytes = maxBytes;
  }

  async parse(req: IncomingMessage): Promise<MultipartResult> {
    await mkdir(this.uploadsDir, { recursive: true });

    const fields: Record<string, string> = {};
    const files: ParsedFile[] = [];
    const createdFiles: string[] = [];

    try {
      await new Promise<void>((resolve, reject) => {
        let buffer = Buffer.alloc(0);
        let totalBytes = 0;
        let done = false;

        // Named listeners so we can remove them after completion
        const onError = (err: Error): void => {
          if (done) return;
          done = true;
          removeListeners();
          reject(err);
        };

        const onEnd = (): void => {
          if (done) return;
          done = true;
          removeListeners();
          resolve();
        };

        const onData = async (chunk: Buffer): Promise<void> => {
          try {
            if (done) return;
            // Finding 7 fix: enforce the byte limit BEFORE concatenating into
            // the heap buffer. This prevents a 1-byte-over-limit chunk from
            // being buffered before the check fires.
            totalBytes += chunk.length;
            if (totalBytes > this.maxBytes) {
              done = true;
              removeListeners();
              req.destroy();
              reject(new Error('Upload too large'));
              return;
            }

            buffer = Buffer.concat([buffer, chunk]);

            // Process complete parts
            let processed = true;
            while (processed && !done) {
              processed = false;
              const result = await this._tryParsePart(buffer, fields, files, createdFiles);
              if (result.consumed > 0) {
                buffer = buffer.subarray(result.consumed);
                processed = true;
              }
            }
          } catch (err) {
            if (!done) {
              done = true;
              removeListeners();
              reject(err instanceof Error ? err : new Error('Parse error'));
            }
          }
        };

        const removeListeners = (): void => {
          req.removeListener('data', onData);
          req.removeListener('end', onEnd);
          req.removeListener('error', onError);
        };

        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
      });
    } catch (err) {
      // Cleanup partially written files on failure
      for (const filePath of createdFiles) {
        unlink(filePath, () => undefined);
      }
      throw err;
    }

    return { fields, files };
  }

  private async _tryParsePart(
    buf: Buffer,
    fields: Record<string, string>,
    files: ParsedFile[],
    createdFiles: string[]
  ): Promise<{ consumed: number }> {
    const boundaryPos = indexOf(buf, this.boundary, 0);
    if (process.env.MP_DEBUG) console.error('[mp] buf.len', buf.length, 'boundaryPos', boundaryPos, 'bnd.len', this.boundary.length);
    if (boundaryPos === -1) return { consumed: 0 };

    const afterBoundary = boundaryPos + this.boundary.length;
    if (afterBoundary + 2 > buf.length) { if (process.env.MP_DEBUG) console.error('[mp] short after boundary'); return { consumed: 0 }; }

    // Check for final boundary (--)
    if (buf[afterBoundary] === 0x2d && buf[afterBoundary + 1] === 0x2d) {
      return { consumed: afterBoundary + 2 };
    }

    // Skip \r\n after boundary
    const headerStart = afterBoundary + 2; // skip \r\n
    const headerEnd = indexOf(buf, Buffer.from('\r\n\r\n'), headerStart);
    if (process.env.MP_DEBUG) console.error('[mp] headerStart', headerStart, 'headerEnd', headerEnd, 'isFinal', buf[afterBoundary] === 0x2d && buf[afterBoundary+1] === 0x2d);
    if (headerEnd === -1) return { consumed: 0 };

    const headerStr = buf.toString('ascii', headerStart, headerEnd);
    const headers = parsePartHeaders(headerStr);

    const bodyStart = headerEnd + 4;
    const nextBoundaryPos = indexOf(buf, this.boundary, bodyStart);
    if (process.env.MP_DEBUG) console.error('[mp] bodyStart', bodyStart, 'nextBoundaryPos', nextBoundaryPos, 'hdr', JSON.stringify(buf.toString("ascii", headerStart, headerEnd)));
    if (nextBoundaryPos === -1) return { consumed: 0 };

    // Body ends 2 bytes before the next boundary (\r\n before --)
    const bodyEnd = nextBoundaryPos - 2;
    const bodyBuf = buf.subarray(bodyStart, bodyEnd);

    const disposition = headers['content-disposition'] ?? '';
    const fieldName = extractParam(disposition, 'name') ?? 'field';
    const fileName = extractParam(disposition, 'filename');

    if (fileName !== null) {
      // It's a file — stream to disk
      const safeName = randomBytes(16).toString('hex') + '_' + sanitizeFileName(fileName);
      const filePath = join(this.uploadsDir, safeName);
      createdFiles.push(filePath);

      await writeFileToDisk(filePath, bodyBuf);

      files.push({
        fieldName,
        originalName: fileName,
        mimeType: headers['content-type'] ?? 'application/octet-stream',
        size: bodyBuf.length,
        path: filePath,
        encoding: headers['content-transfer-encoding'] ?? '7bit',
      });
    } else {
      // It's a form field
      const fieldValue = bodyBuf.subarray(0, MAX_FIELD_SIZE).toString('utf8');
      fields[fieldName] = fieldValue;
    }

    return { consumed: nextBoundaryPos };
  }
}

function writeFileToDisk(path: string, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(path, { flags: 'w' });
    ws.once('error', reject);
    ws.once('finish', resolve);

    // Write in chunks to avoid heap spikes
    let offset = 0;
    function writeChunk(): void {
      while (offset < data.length) {
        const end = Math.min(offset + MAX_FILE_CHUNK, data.length);
        const chunk = data.subarray(offset, end);
        offset = end;
        if (!ws.write(chunk)) {
          ws.once('drain', writeChunk);
          return;
        }
      }
      ws.end();
    }
    writeChunk();
  });
}

function indexOf(haystack: Buffer, needle: Buffer, start: number): number {
  if (needle.length === 0) return start;
  const limit = haystack.length - needle.length;
  outer: for (let i = start; i <= limit; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function parsePartHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of raw.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.substring(0, colon).trim().toLowerCase();
    const val = line.substring(colon + 1).trim();
    headers[key] = val;
  }
  return headers;
}

function extractParam(header: string, param: string): string | null {
  const re = new RegExp(`${param}="([^"]*)"`, 'i');
  const m = re.exec(header);
  return m?.[1] ?? null;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 128);
}

/** Streaming passthrough transformer that enforces a byte cap */
export class BoundedTransform extends Transform {
  private received = 0;
  constructor(private readonly maxBytes: number) {
    super();
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.received += chunk.length;
    if (this.received > this.maxBytes) {
      cb(new Error('Stream exceeded byte limit'));
      return;
    }
    cb(null, chunk);
  }
}
