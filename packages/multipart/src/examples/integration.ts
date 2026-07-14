/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Parses an in-memory multipart/form-data body (streamed through a Readable, as
 * an HTTP request would arrive) into fields and files-on-disk, then cleans up.
 */

import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';

import { MultipartParser } from '../index.js';

const BOUNDARY = '----streetexample';

function body(): Buffer {
  const parts = [
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="username"\r\n\r\nada\r\n`,
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="avatar"; filename="hello.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\nHello from an uploaded file!\r\n`,
    `--${BOUNDARY}--\r\n`,
  ];
  return Buffer.from(parts.join(''), 'utf8');
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'street-upload-'));
  try {
    const parser = new MultipartParser(BOUNDARY, dir, 5 * 1024 * 1024);
    // A request-like stream: push the body, then signal EOF on a later tick
    // (as a real socket does, so the parser's async writes settle first).
    const req = new Readable({ read() {} }) as unknown as IncomingMessage;
    (req as unknown as Readable).push(body());
    setTimeout(() => (req as unknown as Readable).push(null), 30);
    const { fields, files } = await parser.parse(req);

    process.stdout.write(`fields: ${JSON.stringify(fields)}\n`);
    for (const f of files) {
      process.stdout.write(
        `file: field=${f.fieldName} name=${f.originalName} type=${f.mimeType} size=${f.size}\n`,
      );
      process.stdout.write(`  contents: ${readFileSync(f.path).toString()}\n`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void main();
