// gcs-storage.integration.test.ts
// Integration tests for the GCS provider against fake-gcs-server (or real GCS).
// Gated on GCS_URL so the suite stays green without an emulator.
//
//   GCS_URL=http://127.0.0.1:4443 npm run test -w packages/storage

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService, GcsStorageProvider, UrlSigner } from '../index.js';

const URL_ = process.env['GCS_URL'];

describe('GcsStorageProvider (live GCS emulator)', { skip: !URL_ ? 'GCS_URL not set' : false }, () => {
  let s: StorageService;

  before(() => {
    s = new StorageService({
      provider: new GcsStorageProvider({
        bucket: `it-bucket-${Date.now()}`,
        endpoint: URL_,
        accessToken: process.env['GCS_TOKEN'],
      }),
      signer: new UrlSigner('a-very-secret-signing-key'),
    });
  });

  it('round-trips binary bytes through multipart upload + media download', async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 13, 10, 0, 200, 7]);
    await s.upload('bin/blob.dat', bytes, { contentType: 'application/octet-stream', metadata: { owner: 'u1' } });
    const got = await s.download('bin/blob.dat');
    assert.ok(got);
    assert.ok(got!.data.equals(bytes), 'bytes must round-trip identically');
    assert.equal(got!.contentType, 'application/octet-stream');
    assert.equal(got!.metadata['owner'], 'u1');
    assert.equal(got!.size, bytes.byteLength);
  });

  it('stores text with content type and lists by prefix', async () => {
    await s.upload('img/a.txt', Buffer.from('alpha'), { contentType: 'text/plain' });
    await s.upload('img/b.txt', Buffer.from('beta'), { contentType: 'text/plain' });
    await s.upload('docs/c.txt', Buffer.from('gamma'));
    const got = await s.download('img/a.txt');
    assert.equal(got!.data.toString(), 'alpha');
    assert.equal(got!.contentType, 'text/plain');
    const keys = (await s.list('img/')).map((o) => o.key);
    assert.deepEqual(keys, ['img/a.txt', 'img/b.txt']);
  });

  it('exists and delete behave correctly', async () => {
    await s.upload('k/exists.txt', Buffer.from('x'));
    assert.equal(await s.exists('k/exists.txt'), true);
    assert.equal(await s.exists('k/missing.txt'), false);
    assert.equal(await s.remove('k/exists.txt'), true);
    assert.equal(await s.exists('k/exists.txt'), false);
    assert.equal(await s.remove('k/exists.txt'), false);
  });

  it('enforces service-layer limits and signed URLs over the GCS provider', async () => {
    const limited = new StorageService({
      provider: new GcsStorageProvider({ bucket: `it-lim-${Date.now()}`, endpoint: URL_ }),
      maxBytes: 4,
    });
    await assert.rejects(() => limited.upload('big', Buffer.from('toolong')), /exceeds limit/);
    const url = s.signedUrl('img/a.txt', { expiresInSeconds: 60 });
    assert.equal(s.verifySignedUrl(url), true);
  });
});
