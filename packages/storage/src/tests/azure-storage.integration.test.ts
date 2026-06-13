// azure-storage.integration.test.ts
// Integration tests for the Azure Blob provider against Azurite (or real Azure).
// Gated on AZURITE_URL so the suite stays green without an emulator.
//
//   AZURITE_URL=http://127.0.0.1:10000 npm run test -w packages/storage
//
// Uses Azurite's well-known dev account credentials.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService, AzureBlobStorageProvider, UrlSigner } from '../index.js';

const URL_ = process.env['AZURITE_URL'];
const DEV_ACCOUNT = 'devstoreaccount1';
const DEV_KEY = 'Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==';

describe('AzureBlobStorageProvider (live Azurite)', { skip: !URL_ ? 'AZURITE_URL not set' : false }, () => {
  let s: StorageService;

  before(() => {
    s = new StorageService({
      provider: new AzureBlobStorageProvider({
        account: DEV_ACCOUNT,
        accountKey: DEV_KEY,
        container: `it${Date.now()}`,
        endpoint: `${URL_}/${DEV_ACCOUNT}`,
      }),
      signer: new UrlSigner('a-very-secret-signing-key'),
    });
  });

  it('round-trips binary bytes with SharedKey auth', async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 255, 13, 10, 0, 99]);
    await s.upload('bin/blob.dat', bytes, { contentType: 'application/octet-stream', metadata: { owner: 'u1' } });
    const got = await s.download('bin/blob.dat');
    assert.ok(got);
    assert.ok(got!.data.equals(bytes), 'bytes must round-trip identically');
    assert.equal(got!.contentType, 'application/octet-stream');
    assert.equal(got!.metadata['owner'], 'u1');
  });

  it('stores text, lists by prefix, exists, and deletes', async () => {
    await s.upload('img/a.txt', Buffer.from('alpha'), { contentType: 'text/plain' });
    await s.upload('img/b.txt', Buffer.from('beta'), { contentType: 'text/plain' });
    await s.upload('docs/c.txt', Buffer.from('gamma'));
    assert.equal((await s.download('img/a.txt'))!.data.toString(), 'alpha');
    assert.deepEqual((await s.list('img/')).map((o) => o.key), ['img/a.txt', 'img/b.txt']);
    assert.equal(await s.exists('img/a.txt'), true);
    assert.equal(await s.exists('img/missing.txt'), false);
    assert.equal(await s.remove('img/a.txt'), true);
    assert.equal(await s.exists('img/a.txt'), false);
  });

  it('enforces service-layer limits and signed URLs over the Azure provider', async () => {
    const limited = new StorageService({
      provider: new AzureBlobStorageProvider({ account: DEV_ACCOUNT, accountKey: DEV_KEY, container: `lim${Date.now()}`, endpoint: `${URL_}/${DEV_ACCOUNT}` }),
      maxBytes: 4,
    });
    await assert.rejects(() => limited.upload('big', Buffer.from('toolong')), /exceeds limit/);
    const url = s.signedUrl('docs/c.txt', { expiresInSeconds: 60 });
    assert.equal(s.verifySignedUrl(url), true);
  });
});
