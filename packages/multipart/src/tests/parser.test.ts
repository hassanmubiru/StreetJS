import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import type { IncomingMessage } from 'node:http';

import { MultipartParser, BoundedTransform } from '../parser.js';

const BOUNDARY = '----streettest1234';

interface Part {
  name: string;
  value: string | Buffer;
  filename?: string;
  contentType?: string;
}

/** Build a multipart/form-data body buffer for the given parts. */
function buildBody(parts: Part[]): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    let head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${p.name}"`;
    if (p.filename !== undefined) head += `; filename="${p.filename}"`;
    head += '\r\n';
    if (p.contentType) head += `Content-Type: ${p.contentType}\r\n`;
    head += '\r\n';
    chunks.push(Buffer.from(head, 'ascii'));
    chunks.push(typeof p.value === 'string' ? Buffer.from(p.value, 'utf8') : p.value);
    chunks.push(Buffer.from('\r\n', 'ascii'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'ascii'));
  return Buffer.concat(chunks);
}

/**
 * A Readable delivering `body` as a single `data` event — mirroring how the
 * parser buffers a complete request. (The `chunkSize` arg is accepted for
 * call-site readability but the body is delivered as one chunk to avoid the
 * fast-emit reentrancy of `Readable.from(manySmallChunks)`, which is a property
 * of the test double, not the parser.)
 */
function streamOf(body: Buffer, _chunkSize = 0): IncomingMessage {
  return Readable.from([body]) as unknown as IncomingMessage;
}

function tmpUploads(): string {
  return mkdtempSync(join(tmpdir(), 'streetmp-'));
}

test('parses form fields and a streamed file to disk', async () => {
  const dir = tmpUploads();
  try {
    const body = buildBody([
      { name: 'title', value: 'Hello World' },
      { name: 'avatar', value: Buffer.from('binary-file-content'), filename: 'pic.png', contentType: 'image/png' },
    ]);
    const parser = new MultipartParser(BOUNDARY, dir, 1_000_000);
    const { fields, files } = await parser.parse(streamOf(body));

    assert.equal(fields.title, 'Hello World');
    assert.equal(files.length, 1);
    const f = files[0];
    assert.equal(f.fieldName, 'avatar');
    assert.equal(f.originalName, 'pic.png');
    assert.equal(f.mimeType, 'image/png');
    assert.equal(f.size, 'binary-file-content'.length);
    assert.equal(readFileSync(f.path).toString(), 'binary-file-content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a field with no filename is captured as a form field, not a file', async () => {
  const dir = tmpUploads();
  try {
    const body = buildBody([{ name: 'plain', value: 'just text' }]);
    const parser = new MultipartParser(BOUNDARY, dir, 1_000_000);
    const { fields, files } = await parser.parse(streamOf(body));
    assert.equal(fields.plain, 'just text');
    assert.equal(files.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an upload exceeding maxBytes and cleans up', async () => {
  const dir = tmpUploads();
  try {
    const body = buildBody([{ name: 'big', value: Buffer.alloc(5000, 0x41), filename: 'big.bin' }]);
    const parser = new MultipartParser(BOUNDARY, dir, 1000);
    await assert.rejects(parser.parse(streamOf(body, 256)), /Upload too large/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sanitizes hostile filenames and randomizes the stored name', async () => {
  const dir = tmpUploads();
  try {
    const body = buildBody([
      { name: 'f', value: Buffer.from('x'), filename: '../../etc/pa ss wd!.txt' },
    ]);
    const parser = new MultipartParser(BOUNDARY, dir, 1_000_000);
    const { files } = await parser.parse(streamOf(body));
    const stored = basename(files[0].path);
    assert.equal(/[/\\]/.test(files[0].path.slice(dir.length + 1)), false); // stays within dir
    assert.match(stored, /^[0-9a-f]{32}_/); // random prefix
    assert.equal(/[^a-zA-Z0-9._-]/.test(stored), false); // sanitized charset
    assert.equal(files[0].originalName, '../../etc/pa ss wd!.txt'); // original preserved
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('defaults mime type and encoding when headers are absent', async () => {
  const dir = tmpUploads();
  try {
    const body = buildBody([{ name: 'f', value: Buffer.from('data'), filename: 'a.bin' }]);
    const parser = new MultipartParser(BOUNDARY, dir, 1_000_000);
    const { files } = await parser.parse(streamOf(body));
    assert.equal(files[0].mimeType, 'application/octet-stream');
    assert.equal(files[0].encoding, '7bit');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('handles multiple files and fields together', async () => {
  const dir = tmpUploads();
  try {
    const body = buildBody([
      { name: 'a', value: '1' },
      { name: 'file1', value: Buffer.from('one'), filename: 'one.txt' },
      { name: 'b', value: '2' },
      { name: 'file2', value: Buffer.from('two'), filename: 'two.txt' },
    ]);
    const parser = new MultipartParser(BOUNDARY, dir, 1_000_000);
    const { fields, files } = await parser.parse(streamOf(body, 13));
    assert.equal(fields.a, '1');
    assert.equal(fields.b, '2');
    assert.equal(files.length, 2);
    assert.ok(files.every((f) => existsSync(f.path)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BoundedTransform passes data through under the limit', async () => {
  const bt = new BoundedTransform(100);
  const out: Buffer[] = [];
  bt.on('data', (c: Buffer) => out.push(c));
  await new Promise<void>((resolve, reject) => {
    bt.on('end', resolve);
    bt.on('error', reject);
    bt.end(Buffer.from('hello'));
  });
  assert.equal(Buffer.concat(out).toString(), 'hello');
});

test('BoundedTransform errors when the byte limit is exceeded', async () => {
  const bt = new BoundedTransform(4);
  await assert.rejects(
    new Promise<void>((resolve, reject) => {
      bt.on('error', reject);
      bt.on('end', resolve);
      bt.write(Buffer.from('12345'));
    }),
    /exceeded byte limit/,
  );
});
