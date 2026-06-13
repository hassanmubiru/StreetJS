// Runnable example: uploads, limits, scan/transform hooks, and signed URLs.
//
//   npm run example -w packages/storage
//
// Uses the in-memory provider (no filesystem or cloud needed).

import { StorageService, UrlSigner, UploadTooLargeError, ScanRejectedError } from '@streetjs/storage';

const storage = new StorageService({
  maxBytes: 1024,
  signer: new UrlSigner('a-very-secret-signing-key'),
  scan: (key, data) => (data.includes(Buffer.from('EICAR')) ? { ok: false, reason: 'malware signature' } : { ok: true }),
  transform: (key, data, ct) => (ct === 'text/plain' ? Buffer.from(data.toString().trim()) : data),
});

// Normal upload (transform trims whitespace).
await storage.upload('notes/hello.txt', Buffer.from('  hi there  \n'), { contentType: 'text/plain' });
console.log('stored:', (await storage.download('notes/hello.txt')).data.toString()); // "hi there"

// Size limit.
try {
  await storage.upload('big.bin', Buffer.alloc(2048));
} catch (e) {
  console.log('limit ->', e instanceof UploadTooLargeError ? e.message : e);
}

// Malware scan hook.
try {
  await storage.upload('infected.txt', Buffer.from('EICAR test'), { contentType: 'text/plain' });
} catch (e) {
  console.log('scan ->', e instanceof ScanRejectedError ? e.message : e);
}

// Signed URL.
const url = storage.signedUrl('notes/hello.txt', { expiresInSeconds: 300 });
console.log('\nsigned url valid?', storage.verifySignedUrl(url));
console.log('tampered url valid?', storage.verifySignedUrl({ ...url, key: 'notes/other.txt' }));

console.log('\nlisting:', await storage.list());
