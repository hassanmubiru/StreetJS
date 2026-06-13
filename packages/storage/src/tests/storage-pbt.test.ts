// storage-pbt.test.ts
// Property-based tests for signed URLs and provider round-tripping.
//
// Properties:
//   P1 (sign/verify soundness): a freshly signed URL always verifies before
//      expiry; any mutation to key/operation/expiry/signature fails to verify.
//   P2 (round-trip): for any key/bytes, upload→download returns identical bytes
//      and exists() reflects the stored state.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { StorageService, InMemoryStorageProvider, UrlSigner } from '../index.js';

const keyArb = fc
  .array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { minLength: 1, maxLength: 4 })
  .map((segs) => segs.join('/'));

describe('Property: signed URLs are sound', () => {
  it('P1: valid before expiry; any tamper fails', () => {
    const signer = new UrlSigner('a-very-secret-key-1234', () => 1_000_000);
    fc.assert(
      fc.property(keyArb, fc.integer({ min: 1, max: 3600 }), fc.constantFrom('get', 'put'), (key, ttl, op) => {
        const url = signer.sign(key, { expiresInSeconds: ttl, operation: op as 'get' | 'put' });
        assert.equal(signer.verify(url), true);
        assert.equal(signer.verify({ ...url, signature: url.signature + '0' }), false);
        assert.equal(signer.verify({ ...url, expiresAt: url.expiresAt + 1 }), false);
        assert.equal(signer.verify({ ...url, key: key + 'x' }), false);
        assert.equal(signer.verify({ ...url, operation: op === 'get' ? 'put' : 'get' }), false);
      }),
      { numRuns: 200 },
    );
  });
});

describe('Property: provider round-trips bytes', () => {
  it('P2: upload→download is identity; exists tracks state', async () => {
    await fc.assert(
      fc.asyncProperty(keyArb, fc.uint8Array({ maxLength: 256 }), async (key, bytes) => {
        const s = new StorageService({ provider: new InMemoryStorageProvider(), maxBytes: 1024 });
        const data = Buffer.from(bytes);
        await s.upload(key, data);
        assert.equal(await s.exists(key), true);
        const got = await s.download(key);
        assert.ok(got);
        assert.ok(Buffer.from(got!.data).equals(data), 'bytes must round-trip identically');
        assert.equal(got!.size, data.byteLength);
        assert.equal(await s.remove(key), true);
        assert.equal(await s.exists(key), false);
      }),
      { numRuns: 150 },
    );
  });
});
