// storage.test.ts
// Unit tests for the storage service, providers, signed URLs, and hooks.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  StorageService,
  InMemoryStorageProvider,
  LocalStorageProvider,
  UrlSigner,
  UploadTooLargeError,
  ScanRejectedError,
  validateKey,
} from '../index.js';

describe('validateKey', () => {
  it('rejects traversal, absolute, NUL, and empty keys', () => {
    assert.throws(() => validateKey(''), /non-empty/);
    assert.throws(() => validateKey('/abs'), /relative/);
    assert.throws(() => validateKey('a/../b'), /\.\./);
    assert.throws(() => validateKey('a\u0000b'), /NUL/);
    assert.equal(validateKey('a/b/c.png'), 'a/b/c.png');
  });
});

describe('StorageService (in-memory)', () => {
  it('uploads, downloads, lists, and removes', async () => {
    const s = new StorageService();
    await s.upload('a/1.txt', Buffer.from('hello'), { contentType: 'text/plain' });
    await s.upload('a/2.txt', Buffer.from('world'));
    const got = await s.download('a/1.txt');
    assert.equal(got!.data.toString(), 'hello');
    assert.equal(got!.contentType, 'text/plain');
    assert.deepEqual((await s.list('a/')).map((o) => o.key), ['a/1.txt', 'a/2.txt']);
    assert.equal(await s.exists('a/1.txt'), true);
    assert.equal(await s.remove('a/1.txt'), true);
    assert.equal(await s.exists('a/1.txt'), false);
  });

  it('enforces the upload size limit', async () => {
    const s = new StorageService({ maxBytes: 4 });
    await assert.rejects(() => s.upload('big', Buffer.from('toolong')), UploadTooLargeError);
    await s.upload('ok', Buffer.from('abcd')); // exactly at limit
    assert.equal(await s.exists('ok'), true);
  });

  it('runs a scan hook and rejects flagged content', async () => {
    const s = new StorageService({
      scan: (_key, data) => (data.includes(Buffer.from('virus')) ? { ok: false, reason: 'malware' } : { ok: true }),
    });
    await assert.rejects(() => s.upload('f', Buffer.from('a virus here')), ScanRejectedError);
    await s.upload('clean', Buffer.from('safe'));
    assert.equal(await s.exists('clean'), true);
  });

  it('applies a transform hook before storing', async () => {
    const s = new StorageService({
      transform: (_key, data) => Buffer.from(data.toString().toUpperCase()),
    });
    await s.upload('x', Buffer.from('hello'));
    assert.equal((await s.download('x'))!.data.toString(), 'HELLO');
  });
});

describe('UrlSigner / signed URLs', () => {
  it('signs and verifies, and rejects tampering and expiry', () => {
    let now = 1_000_000;
    const signer = new UrlSigner('a-very-secret-key-1234', () => now);
    const url = signer.sign('a/photo.png', { expiresInSeconds: 60, operation: 'get' });
    assert.equal(signer.verify(url), true);

    // Tampered key.
    assert.equal(signer.verify({ ...url, key: 'a/other.png' }), false);
    // Tampered operation.
    assert.equal(signer.verify({ ...url, operation: 'put' }), false);
    // Expired.
    now += 61_000;
    assert.equal(signer.verify(url), false);
  });

  it('requires a sufficiently long secret', () => {
    assert.throws(() => new UrlSigner('short'), /at least 16/);
  });

  it('StorageService integrates the signer', () => {
    const s = new StorageService({ signer: new UrlSigner('a-very-secret-key-1234') });
    const url = s.signedUrl('a/b.png');
    assert.equal(s.verifySignedUrl(url), true);
    const noSigner = new StorageService();
    assert.throws(() => noSigner.signedUrl('x'), /signer is required/);
  });
});

describe('LocalStorageProvider', () => {
  let dir: string;
  before(async () => { dir = await fs.mkdtemp(join(tmpdir(), 'street-storage-')); });
  after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('round-trips through the filesystem and prevents traversal', async () => {
    const s = new StorageService({ provider: new LocalStorageProvider(dir) });
    await s.upload('nested/dir/file.txt', Buffer.from('disk!'), { contentType: 'text/plain', metadata: { a: '1' } });
    const got = await s.download('nested/dir/file.txt');
    assert.equal(got!.data.toString(), 'disk!');
    assert.equal(got!.contentType, 'text/plain');
    assert.deepEqual(got!.metadata, { a: '1' });
    assert.deepEqual((await s.list()).map((o) => o.key), ['nested/dir/file.txt']);
    assert.equal(await s.remove('nested/dir/file.txt'), true);

    const provider = new LocalStorageProvider(dir);
    await assert.rejects(() => provider.put('../escape.txt', Buffer.from('x')), /path traversal/);
  });
});

describe('provider parity', () => {
  it('memory and local providers behave the same for core ops', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'street-parity-'));
    try {
      for (const provider of [new InMemoryStorageProvider(), new LocalStorageProvider(dir)]) {
        const s = new StorageService({ provider });
        assert.equal(await s.exists('k'), false);
        await s.upload('k', Buffer.from('v'));
        assert.equal(await s.exists('k'), true);
        assert.equal((await s.download('k'))!.data.toString(), 'v');
        assert.equal(await s.remove('k'), true);
        assert.equal(await s.remove('k'), false);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
