# @streetjs/storage

Official Street Framework storage module: a **unified file-storage API** with
pluggable providers and cross-cutting concerns handled once at the service
layer — upload limits, malware/scan hooks, transform hooks, and signed URLs.

- Providers: `InMemoryStorageProvider` (default), `LocalStorageProvider` (FS, traversal-safe),
  `PgStorageProvider` (Postgres), `GcsStorageProvider` (Google Cloud Storage / fake-gcs),
  `AzureBlobStorageProvider` (Azure Blob / Azurite, SharedKey auth) — all verified against live services
- S3 / Cloudflare R2 ship as `@streetjs/plugin-s3` and `@streetjs/plugin-r2`
- Upload size limits, async scan hooks (malware), transform hooks (image opt.)
- HMAC signed URLs with expiry + verification

## Install

```bash
npm install @streetjs/storage
```

## Quick start

```ts
import { StorageService, LocalStorageProvider, UrlSigner } from '@streetjs/storage';

const storage = new StorageService({
  provider: new LocalStorageProvider('/var/data/uploads'),
  maxBytes: 5 * 1024 * 1024,                       // 5 MiB cap
  signer: new UrlSigner(process.env.STORAGE_SIGNING_SECRET),
  scan: async (key, data) => /* malware hook */ ({ ok: true }),
  transform: async (key, data, ct) => /* image optimization */ data,
});

await storage.upload('avatars/u1.png', buf, { contentType: 'image/png' });
const obj = await storage.download('avatars/u1.png');

const url = storage.signedUrl('avatars/u1.png', { expiresInSeconds: 600, operation: 'get' });
storage.verifySignedUrl(url); // true until it expires
```

## Cross-cutting concerns

| Concern | How |
|---|---|
| Upload limit | `maxBytes` → `UploadTooLargeError` (checked before and after transform) |
| Malware/scan | `scan(key, data, contentType)` → `{ ok:false, reason }` throws `ScanRejectedError` |
| Image optimization | `transform(key, data, contentType)` returns the bytes to store |
| Signed URLs | `UrlSigner` (HMAC-SHA256 over op+key+expiry); tamper/expiry safe |
| Path safety | keys validated (no `..`, no absolute, no NUL); `LocalStorageProvider` refuses traversal |

## Writing a provider (S3/R2/Azure/GCS)

Implement `StorageProvider` (`put`/`get`/`delete`/`exists`/`list`). The service
layer adds limits, hooks, and signing on top, so a provider only handles bytes.

## API

- `new StorageService({ provider?, maxBytes?, scan?, transform?, signer? })`
- `upload`, `download`, `remove`, `exists`, `list`, `signedUrl`, `verifySignedUrl`
- Providers: `InMemoryStorageProvider`, `LocalStorageProvider`
- `UrlSigner`, `validateKey`
- Errors: `UploadTooLargeError`, `ScanRejectedError`

## Testing

```bash
npm run test -w packages/storage     # unit + property tests, no external services
```

## License

MIT
