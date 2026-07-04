<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/storage

StreetJS Core v2 **Pillar 4**: a production-grade, strongly typed, cloud-agnostic
object storage framework. One consistent API surface across every supported
provider — switching between Memory, Local, S3, Cloudflare R2, Supabase, Google
Cloud Storage, Azure Blob, MinIO, and Backblaze B2 is a **configuration change,
never an application rewrite**.

- **Unified facade** — `createStorage(config)` returns a `Storage` whose method
  signatures are identical no matter which driver backs it.
- **Zero-dependency core** — `streetjs` is the only runtime dependency. The
  `memory` and `local` drivers need nothing else.
- **Optional provider SDKs** — every cloud provider lives behind its own
  submodule (`@streetjs/storage/s3`, `/r2`, `/supabase`, `/gcs`, `/azure`,
  `/minio`, `/backblaze`) and its SDK is an **optional peer dependency**, pulled
  in only when you actually use that provider.
- **Full feature set** — object operations, streaming, multipart, resumable
  uploads, signed URLs, validation, typed metadata, versioning, lifecycle rules,
  image processing, a directory API, and search.
- **Ecosystem bridges** — optional, no-hard-dependency integration with
  `@streetjs/events`, `@streetjs/queue`, and `@streetjs/realtime`, plus reuse of
  the core `MetricsRegistry` / `HealthCheckRegistry`.
- **In-process test doubles** — `@streetjs/storage/testing`.

## Install

```bash
npm install @streetjs/storage
```

That is all you need for the `memory` and `local` drivers. Cloud providers each
require their own optional peer SDK — see the per-provider guides below.

## Quick Start

```ts
import { createStorage } from "@streetjs/storage";

// A zero-dependency, in-memory store — great for tests and getting started.
const storage = createStorage({ provider: "memory" });

// Put returns the typed object metadata.
const meta = await storage.put("avatars/u1.png", pngBytes, {
  contentType: "image/png",
  owner: "user-1",
});
console.log(meta.size, meta.etag, meta.checksum, meta.createdAt);

// Get returns a discriminated result — no throw on a missing key.
const result = await storage.get("avatars/u1.png");
if (result.found) {
  console.log(result.bytes, result.metadata);
}

// The rest of the object surface.
await storage.exists("avatars/u1.png"); // boolean
await storage.copy("avatars/u1.png", "avatars/u1-copy.png");
await storage.move("avatars/u1-copy.png", "trash/u1.png");
await storage.rename("trash/u1.png", "trash/old.png");
const items = await storage.list("avatars/"); // [{ key, size, updatedAt }]
const stat = await storage.stat("avatars/u1.png"); // metadata | null
await storage.delete("avatars/u1.png");

await storage.close();
```

Use the `local` driver to persist to the filesystem. It requires a `root`:

```ts
import { createStorage } from "@streetjs/storage";

const storage = createStorage({ provider: "local", root: "/var/data/uploads" });
await storage.put("reports/2024.csv", csvBytes, { contentType: "text/csv" });
```

### Configuration

`createStorage(config)` accepts:

| Field | Type | Purpose |
|---|---|---|
| `provider` | `"memory" \| "local" \| string` | Selects a built-in driver, or names a cloud provider when you also pass `driver`. |
| `driver` | `StorageDriver` | A pre-constructed cloud driver (from a submodule). Takes precedence over `provider`. |
| `root` | `string` | Filesystem root for the `local` driver. |
| `clock` | `Clock` | Inject deterministic time (timestamps, signed-URL expiry, lifecycle age). |
| `validation` | `ValidationConfig` | Upload validation pipeline (see Validation). |
| `versioning` | `boolean` | Snapshot prior content on overwrite. |
| `signingSecret` | `string` | HMAC key for simulated signed URLs. |
| `metrics` | `MetricsRegistry` | Register storage metrics with the core registry. |
| `health` | `HealthCheckRegistry` | Register storage health checks with the core registry. |
| `auth` | `AuthLike` | Structural auth bridge for access-control decisions. |
| `imageCodec` | `ImageCodec` | Structural codec that performs image transforms. |
| `bridges` | `{ events?, queue?, realtime? }` | Structural ecosystem bridges. |

If `provider` is an unknown name and no `driver` is supplied, `createStorage`
throws a descriptive `StorageConfigError` and returns no instance.

## Providers

Every cloud driver exposes **two construction styles**:

- A synchronous `create…Driver(client, options?)` that wraps an **injected**
  structural client. No SDK is loaded — ideal for tests and for supplying your
  own client.
- An asynchronous `connect…Driver(config)` / `create…DriverFromConfig(config)`
  that **builds its own client** by lazily `import()`-ing the provider SDK. If
  the optional peer SDK is not installed, it throws a `StorageConfigError`.

For cloud providers you construct the driver, then pass it to `createStorage`
as a pre-constructed `driver`:

```ts
const driver = await connectSomeDriver({ /* ... */ });
const storage = createStorage({ provider: "s3", driver });
```

### Memory (`provider: "memory"`)

Zero external dependencies, fully in-process. Every feature is simulated over
in-memory primitives. Best for tests, examples, and ephemeral workloads.

```ts
import { createStorage } from "@streetjs/storage";

const storage = createStorage({ provider: "memory" });
```

### Local filesystem (`provider: "local"`)

Zero external dependencies. Persists objects under a `root` directory.

```ts
import { createStorage } from "@streetjs/storage";

const storage = createStorage({ provider: "local", root: "/var/data/uploads" });
```

### Amazon S3 — `@streetjs/storage/s3`

Optional peer dependencies: `@aws-sdk/client-s3` and (for signed URLs)
`@aws-sdk/s3-request-presigner`.

```ts
import { createStorage } from "@streetjs/storage";
import {
  createS3StorageDriver,
  createS3StorageDriverFromConfig,
} from "@streetjs/storage/s3";

// Build a client from config (lazily imports the AWS SDK):
const driver = await createS3StorageDriverFromConfig({
  bucket: "my-bucket",
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Or wrap an injected, SDK-free structural client (no AWS SDK needed):
// const driver = createS3StorageDriver(myS3ClientLike);

const storage = createStorage({ provider: "s3", driver });
```

### Cloudflare R2 — `@streetjs/storage/r2`

R2 speaks the S3 API. Optional peer dependency: `@aws-sdk/client-s3`.

```ts
import { createStorage } from "@streetjs/storage";
import {
  connectCloudflareR2Driver,
  createCloudflareR2Driver,
} from "@streetjs/storage/r2";

const driver = await connectCloudflareR2Driver({
  accountId: process.env.R2_ACCOUNT_ID!,
  bucket: "my-bucket",
  accessKeyId: process.env.R2_ACCESS_KEY_ID!,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  // endpoint defaults to https://<accountId>.r2.cloudflarestorage.com
});

// SDK-free alternative with an injected client:
// const driver = createCloudflareR2Driver(myS3ClientLike);

const storage = createStorage({ provider: "r2", driver });
```

### Supabase Storage — `@streetjs/storage/supabase`

Optional peer dependency: `@supabase/supabase-js`.

```ts
import { createStorage } from "@streetjs/storage";
import {
  connectSupabaseStorageDriver,
  createSupabaseStorageDriver,
} from "@streetjs/storage/supabase";

const driver = await connectSupabaseStorageDriver({
  url: process.env.SUPABASE_URL!,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  bucket: "uploads",
});

// SDK-free alternative with an injected structural client:
// const driver = createSupabaseStorageDriver(mySupabaseClientLike);

const storage = createStorage({ provider: "supabase", driver });
```

### Google Cloud Storage — `@streetjs/storage/gcs`

Optional peer dependency: `@google-cloud/storage`.

```ts
import { createStorage } from "@streetjs/storage";
import {
  connectGoogleCloudStorageDriver,
  createGoogleCloudStorageDriver,
} from "@streetjs/storage/gcs";

const driver = await connectGoogleCloudStorageDriver({
  bucket: "my-bucket",
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

// SDK-free alternative with an injected structural client:
// const driver = createGoogleCloudStorageDriver(myGcsClientLike);

const storage = createStorage({ provider: "gcs", driver });
```

### Azure Blob Storage — `@streetjs/storage/azure`

Optional peer dependency: `@azure/storage-blob`.

```ts
import { createStorage } from "@streetjs/storage";
import {
  connectAzureBlobDriver,
  createAzureBlobDriver,
} from "@streetjs/storage/azure";

const driver = await connectAzureBlobDriver({
  container: "uploads",
  connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!,
});

// SDK-free alternative with an injected structural client:
// const driver = createAzureBlobDriver(myAzureBlobClientLike);

const storage = createStorage({ provider: "azure", driver });
```

### MinIO — `@streetjs/storage/minio`

Self-hosted, S3-compatible. Optional peer dependency: `minio`.

```ts
import { createStorage } from "@streetjs/storage";
import { connectMinIODriver, createMinIODriver } from "@streetjs/storage/minio";

const driver = await connectMinIODriver({
  bucket: "uploads",
  endPoint: "127.0.0.1",
  port: 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
});

// SDK-free alternative with an injected S3-compatible client:
// const driver = createMinIODriver(myS3ClientLike);

const storage = createStorage({ provider: "minio", driver });
```

### Backblaze B2 — `@streetjs/storage/backblaze`

B2 exposes a fully S3-compatible API. Optional peer dependency:
`@aws-sdk/client-s3`.

```ts
import { createStorage } from "@streetjs/storage";
import { createBackblazeB2Driver } from "@streetjs/storage/backblaze";

// From connection config (async — lazily imports the S3 SDK):
const driver = await createBackblazeB2Driver({
  bucket: "my-bucket",
  endpoint: "https://s3.us-west-002.backblazeb2.com",
  region: "us-west-002",
  credentials: {
    accessKeyId: process.env.B2_KEY_ID!,       // B2 keyId
    secretAccessKey: process.env.B2_APP_KEY!,  // B2 applicationKey
  },
});

// SDK-free alternative with an injected client (sync):
// const driver = createBackblazeB2Driver(myS3ClientLike);

const storage = createStorage({ provider: "backblaze", driver });
```

## Streaming

Transfer large files without buffering the whole object in memory.

```ts
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

// Write from a Node Readable.
await storage.putStream(
  "videos/clip.mp4",
  createReadStream("./clip.mp4"),
  { contentType: "video/mp4" },
);

// Read into a Node Writable.
const download = await storage.getStream("videos/clip.mp4");
await pipeline(download, createWriteStream("./out.mp4"));
```

`getStream` throws when the key does not exist.

## Multipart Uploads

Upload very large objects as independent parts, then assemble them.

```ts
const uploadId = await storage.createMultipartUpload("archives/big.tar", {
  contentType: "application/x-tar",
});

const part1 = await storage.uploadPart(uploadId, 1, chunk1);
const part2 = await storage.uploadPart(uploadId, 2, chunk2);

// Complete assembles the parts in order into a single object.
const meta = await storage.completeMultipartUpload(uploadId, [part1, part2]);

// Or discard everything:
// await storage.abortMultipartUpload(uploadId);
```

The concatenation of the ordered parts equals the final object content.

## Resumable Uploads

Continue an interrupted upload from the last persisted offset instead of
restarting.

```ts
const sessionId = await storage.startUpload("backups/db.sql", {
  contentType: "application/sql",
});

// If a transfer is interrupted, resume with the remaining stream.
const meta = await storage.resumeUpload(sessionId, remainingStream);

// Cancel a session that is not already completing:
// await storage.cancelUpload(sessionId);
```

A completed resumable upload yields the same content as an equivalent
uninterrupted upload.

## Signed URLs

Time-limited URLs that authorize exactly one operation (`GET`, `PUT`, or
`DELETE`) on a key. Configure a `signingSecret` for the simulated signer used by
the memory/local drivers.

```ts
const storage = createStorage({ provider: "memory", signingSecret: "s3cr3t" });

const getUrl = await storage.signedUrl("reports/2024.pdf", "GET", {
  expiresInMs: 10 * 60 * 1000, // 10 minutes
});

const putUrl = await storage.signedUrl("uploads/incoming.bin", "PUT", {
  expiresInMs: 60_000,
  contentType: "application/octet-stream",
  maxSize: 5 * 1024 * 1024,
});
```

Signed-URL options: `expiresInMs`, `headers`, `contentType`, `maxSize`,
`metadata`. A URL used after its expiration is rejected; used before expiration
for the authorized operation, it is permitted.

## Validation

Run a configurable pipeline before any bytes are persisted. A rejected upload
aborts with a descriptive `ValidationError` and leaves no partial object.

```ts
const storage = createStorage({
  provider: "memory",
  validation: {
    allowedMimeTypes: ["image/png", "image/jpeg"],
    allowedExtensions: [".png", ".jpg", ".jpeg"],
    maxSize: 2 * 1024 * 1024,
    filenamePattern: /^[\w./-]+$/,
    requireChecksum: false,
    custom: (input) =>
      input.key.startsWith("public/")
        ? { ok: false, error: "public/ is reserved" }
        : { ok: true },
  },
});
```

## Typed Metadata

Every object carries a typed `StorageObjectMetadata`: `key`, `size`,
`contentType`, `etag`, `checksum`, `owner`, `tenant`, `accessLevel`,
`createdAt`, `updatedAt`, `custom`, and optional `versionId`. Written metadata
round-trips through read, and the field set is preserved across providers.

```ts
await storage.put("docs/spec.md", bytes, {
  contentType: "text/markdown",
  owner: "user-1",
  tenant: "acme",
  accessLevel: "private",
  custom: { project: "atlas" },
});

const meta = await storage.stat("docs/spec.md");
// meta?.custom.project === "atlas"
```

## Access Control

Set a per-object `accessLevel` and supply a structural `auth` bridge to make
authenticated, role-based, and tenant-aware decisions. Access levels: `public`,
`private`, `signed`, `authenticated`, `role-based`, `tenant-aware`. A denied
operation throws an `AuthorizationError` before any read or write occurs;
`public` objects are readable without authentication.

```ts
const storage = createStorage({
  provider: "memory",
  auth: {
    can: ({ operation, accessLevel, owner }) => {
      if (accessLevel === "public" && operation === "read") return true;
      return owner === currentUserId; // your own logic
    },
  },
});
```

## Lifecycle Rules

Apply age/state-based policies. When a rule fires, the events bridge (if wired)
publishes the corresponding lifecycle event.

```ts
// Delete objects under "temp/" older than 7 days.
await storage.applyLifecycle({ type: "delete-after-days", days: 7, prefix: "temp/" });

// Archive after N months.
await storage.applyLifecycle({ type: "archive-after-months", months: 6, prefix: "logs/" });

// Expire temporary uploads after a duration.
await storage.applyLifecycle({ type: "expire-temp-uploads", afterMs: 3_600_000 });

// Move to cold storage after N days.
await storage.applyLifecycle({
  type: "move-to-cold",
  afterDays: 30,
  coldPrefix: "cold/",
  prefix: "media/",
});
```

Each returns the `LifecycleOutcome[]` describing which keys were acted on. A
qualifying object is acted on exactly once.

## Image Processing

`storage.images.transform(key, operations)` produces a transformed variant and
returns its metadata. Supported operations: `resize`, `crop`, `rotate`, `fit`,
`thumbnail`, `compress`; output formats: `webp`, `avif`, `png`, `jpeg`. Supply a
structural `imageCodec` in config to perform the pixel work. A non-image source
yields a descriptive error and never mutates the source.

```ts
const storage = createStorage({ provider: "memory", imageCodec: myCodec });

await storage.put("avatars/u1.png", pngBytes, { contentType: "image/png" });

const thumb = await storage.images.transform("avatars/u1.png", {
  resize: { width: 128, height: 128 },
  format: "webp",
  quality: 80,
});
```

## Directory API

Prefix-based hierarchy that works even on prefix-only providers.

```ts
await storage.directory.mkdir("projects/atlas/");
const children = await storage.directory.listDirectory("projects/"); // immediate children
const allKeys = await storage.directory.walk("projects/"); // every key beneath
const { removed } = await storage.directory.removeDirectory("projects/atlas/");
```

## Search

Filter stored objects by attributes. Only objects matching **every** supplied
filter are returned; an empty match set returns `[]`.

```ts
const results = await storage.search({
  prefix: "media/",
  contentType: "image/png",
  owner: "user-1",
  tenant: "acme",
  minSize: 1_024,
  maxSize: 5_000_000,
  updatedAfter: Date.now() - 86_400_000,
  metadata: { project: "atlas" },
});
```

## Queue Integration

Hand heavy work to `@streetjs/queue` without a hard dependency. Provide a
structural `bridges.queue` (`{ dispatch(job, payload) }`). Dispatch is
fire-and-forget and never breaks a storage operation, so storage keeps working
whether or not the queue is present.

```ts
import { bridgeStorageQueue } from "@streetjs/storage";

const storage = createStorage({
  provider: "memory",
  bridges: { queue: myQueueLike }, // { dispatch(job, payload) }
});

// Or use the bridge directly to dispatch typed jobs:
const publisher = bridgeStorageQueue(myQueueLike);
publisher.thumbnail("avatars/u1.png");
publisher.virusScan("uploads/incoming.bin");
```

Job names: `storage.thumbnail`, `storage.virus-scan`, `storage.ocr`,
`storage.pdf-process`, `storage.transcode`, `storage.image-optimize`,
`storage.archive`.

## Events Integration

Publish typed storage events through `@streetjs/events` (no hard/circular
dependency). Provide a structural `bridges.events` (`{ publish(event, payload) }`).

```ts
import { bridgeStorageEvents } from "@streetjs/storage";

const storage = createStorage({
  provider: "memory",
  bridges: { events: myEventsLike }, // { publish(event, payload) }
});
```

Object mutations publish `storage.uploaded`, `storage.updated`,
`storage.deleted`, `storage.moved`, `storage.restored`, and `storage.expired`;
each payload carries the affected `key` and, when available, its metadata.

## Realtime Integration

Broadcast upload progress through `@streetjs/realtime` without a hard
dependency. Provide a structural `bridges.realtime`
(`{ broadcast(channel, event, payload) }`).

```ts
import { bridgeStorageRealtime, STORAGE_UPLOAD_CHANNEL } from "@streetjs/storage";

const storage = createStorage({
  provider: "memory",
  bridges: { realtime: myRealtimeLike },
});
```

Events are broadcast on the `storage.uploads` channel: `upload.started`,
`upload.progress`, `upload.completed`, and `upload.failed`. A missing realtime
bridge simply means no broadcasts — uploads proceed unaffected.

## Plugin

Register storage in the StreetJS plugin system with `StoragePlugin`. Its options
extend `StorageConfig`, so provider, bridges, and the `metrics` / `health`
registries are all supplied through the plugin. The live facade is available via
`plugin.storage` after load.

```ts
import { StoragePlugin } from "@streetjs/storage";

const plugin = new StoragePlugin({
  provider: "local",
  root: "/var/data/uploads",
  metrics,
  health,
});

await plugin.onLoad(app);
const storage = plugin.storage!; // the live Storage facade
```

## Observability

Pass the core `MetricsRegistry` and/or `HealthCheckRegistry` and storage records
metrics (uploads, downloads, bytes, active/failed uploads, usage, latency,
multipart, resumable) and registers health checks (connectivity, writability,
readability, quota). `storage.stats()` returns a live snapshot; `storage.probe()`
returns a connectivity/quota probe.

```ts
const storage = createStorage({ provider: "memory", metrics, health });
const snapshot = storage.stats();
const probe = await storage.probe();
```

## CLI

`StorageCommands` provides `make:storage`, `storage:list`, `storage:sync`,
`storage:clean`, `storage:migrate`, and `storage:verify`. These are **registered
by your application through the core `CliKernel`** (construct `StorageCommands`
and register it) — they are not part of the standalone `@streetjs/cli` (`street`)
built-in command set. Once registered they are invoked as shown below:

```bash
street make:storage Avatars --dir src/storage --provider local
street storage:list uploads/ --provider local --root /var/data/uploads
street storage:clean temp/ --provider local --root /var/data/uploads
street storage:sync media/ --from-provider local --from-root ./a --to-provider memory
street storage:migrate media/ --from-provider local --from-root ./a --to-provider local --to-root ./b
street storage:verify --provider local --root /var/data/uploads
```

## Testing

`@streetjs/storage/testing` provides in-process, zero-network doubles that
implement the same contract as production drivers.

```ts
import {
  MemoryStorage,
  FakeStorage,
  StorageHarness,
  FakeUpload,
  FakeDownload,
} from "@streetjs/storage/testing";

// A real facade over the in-memory driver.
const storage = MemoryStorage();

// A double with an advanceable clock for time-sensitive behavior.
const fake = new FakeStorage();
await fake.put("k", "hello");
fake.advanceTime(60_000); // move time forward (signed-URL expiry, lifecycle age)

// A harness bundling a clock, storage, and assertion helpers.
const harness = new StorageHarness();
await harness.storage.put("a.txt", "hi");
await harness.assertExists("a.txt");
await harness.assertContent("a.txt", "hi");
await harness.assertKeys("", ["a.txt"]);

// Chunked upload / download doubles.
const upload = new FakeUpload(storage, "big.bin");
upload.write(chunk1);
upload.write(chunk2);
await upload.complete();

const download = new FakeDownload(storage, "big.bin");
const text = await download.text();
```

`MemoryStorageDriver` is also re-exported for substitution at the driver level.

## Migration

Coming from an older, service/provider-based storage layer? The main changes:

- Construct with the `createStorage(config)` factory instead of
  instantiating a service class. Pick a driver with `provider` (built-in) or a
  pre-constructed `driver` (cloud).
- Use the object-operation names `put` / `get` / `delete` (rather than
  `upload` / `download` / `remove`). `get` returns a `{ found, bytes, metadata }`
  result instead of throwing on a missing key.
- Signed URLs come from `storage.signedUrl(key, op, options)` with
  `op` being `"GET" | "PUT" | "DELETE"` and durations expressed in **milliseconds**
  via `expiresInMs`.
- Validation, versioning, lifecycle, images, directory, and search are
  first-class methods on the facade rather than separate hooks.

To move existing data **between stores**, use the CLI:

```bash
# Copy (source untouched):
street storage:sync <prefix> --from-provider <p> --to-provider <p>
# Move (copy, then remove from source):
street storage:migrate <prefix> --from-provider <p> --to-provider <p>
```

## License

MIT
