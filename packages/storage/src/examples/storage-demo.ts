/**
 * @streetjs/storage — runnable end-to-end example (task 31.1).
 *
 * This is the example application required by Requirement 25. It demonstrates
 * the storage framework working end to end **entirely in-process**: it uses a
 * Zero_Dependency_Driver (the in-memory provider) with no external services,
 * no network calls, and no real image library (Requirements 25.1, 25.2, 25.3).
 *
 * The demo walks through the full "avatar" lifecycle a typical application
 * exercises:
 *
 * 1. Upload an avatar (`put`).
 * 2. Download it back and confirm the bytes round-trip (`get`).
 * 3. Replace the avatar with new content (`put` over the same key).
 * 4. List stored objects (`list`).
 * 5. Delete an object (`delete`).
 * 6. Generate a signed URL (`signedUrl`, backed by `config.signingSecret`).
 * 7. Show upload progress — both via a Realtime bridge that logs
 *    `upload.*` events and via a per-chunk progress callback feeding
 *    `putStream`.
 * 8. Resize an image (`images.transform` with `resize`).
 * 9. Generate a thumbnail (`images.transform` with `thumbnail`).
 * 10. Inspect metadata (`stat`).
 *
 * Image work is delegated to a tiny in-process **fake** {@link ImageCodec}
 * (`config.imageCodec`) so resize/thumbnail run without a real image library.
 * The codec simply records the requested transform in the produced bytes; it is
 * illustrative, not a real encoder.
 *
 * The module exports {@link runStorageDemo} so the smoke test (task 31.2) can
 * import and run it, and it is directly runnable via `npm run example`
 * (`node dist/examples/storage-demo.js`).
 *
 * _Requirements: 25.1, 25.2, 25.3_
 */

import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import { createStorage } from "../index.js";
import type { ImageCodec, RealtimeLike } from "../index.js";

/**
 * A minimal, dependency-free fake image codec. A real deployment would supply
 * a `sharp`/`jimp`-backed codec here; for the demo we only need something that
 * proves the framework's resize/thumbnail/format orchestration works without a
 * real image library. It returns new bytes that encode the requested operation
 * so the produced variant is deterministic and distinguishable from the source.
 */
const fakeImageCodec: ImageCodec = {
  transform(bytes, operation) {
    const width = operation.resize?.width ?? "auto";
    const height = operation.resize?.height ?? "auto";
    const format = operation.format ?? "png";
    const quality = operation.quality ?? "default";
    // The "encoded" variant: a small header describing the transform followed by
    // a length-scaled slice of the source bytes. Purely illustrative.
    const header = Buffer.from(
      `FAKE-IMG;format=${format};w=${width};h=${height};q=${quality};src=${bytes.byteLength}\n`,
      "utf8",
    );
    return Buffer.concat([header, Buffer.from(bytes.slice(0, 16))]);
  },
};

/**
 * A tiny in-process Realtime bridge that just logs every broadcast. In a real
 * app this would be the `@streetjs/realtime` server; here it demonstrates that
 * upload state transitions (`upload.started` / `upload.completed` / ...) flow
 * through the configured bridge with no external service.
 */
function loggingRealtimeBridge(log: (line: string) => void): RealtimeLike {
  return {
    broadcast(channel, event, payload) {
      log(`  [realtime] ${channel} → ${event} ${JSON.stringify(payload)}`);
    },
  };
}

/**
 * Build a Node Readable stream from `data`, emitting it in fixed-size chunks and
 * invoking `onProgress(bytesSoFar, total)` as each chunk is produced. This is
 * how the demo surfaces byte-level upload progress via a progress callback,
 * complementing the Realtime bridge's state-transition events.
 */
function chunkedStream(
  data: Uint8Array,
  chunkSize: number,
  onProgress: (bytesTransferred: number, totalBytes: number) => void,
): Readable {
  let offset = 0;
  const total = data.byteLength;
  return new Readable({
    read() {
      if (offset >= total) {
        this.push(null);
        return;
      }
      const end = Math.min(offset + chunkSize, total);
      const chunk = Buffer.from(data.slice(offset, end));
      offset = end;
      onProgress(offset, total);
      this.push(chunk);
    },
  });
}

/** A trivial deterministic PNG-ish payload for the demo avatar (not a real PNG). */
function makeAvatarBytes(label: string, size: number): Uint8Array {
  const bytes = Buffer.alloc(size);
  // Fake PNG signature so it reads as image-like content; content type is what
  // actually drives the image processor, but this keeps the payload plausible.
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  Buffer.from(label, "utf8").copy(bytes, 8);
  return bytes;
}

/**
 * Run the storage demo end to end against the zero-dependency in-memory
 * provider. Accepts an optional `log` sink (defaults to `console.log`) so the
 * smoke test can capture output. Returns a small summary of the demonstrated
 * operations so callers can assert on the outcome (Requirement 25.3).
 */
export async function runStorageDemo(
  log: (line: string) => void = (line) => console.log(line),
): Promise<{
  readonly downloaded: string;
  readonly replaced: string;
  readonly listedKeys: readonly string[];
  readonly deletedKey: string;
  readonly signedUrl: string;
  readonly progressUpdates: number;
  readonly resizedKey: string;
  readonly thumbnailKey: string;
  readonly avatarSize: number;
}> {
  log("=== @streetjs/storage demo (zero-dependency, no external services) ===\n");

  const realtimeLog: string[] = [];

  // 1. Construct the facade against the in-memory provider. A signing secret
  //    enables signed URLs; the fake codec enables image processing; the
  //    realtime bridge surfaces upload progress — all in-process.
  const storage = createStorage({
    provider: "memory",
    signingSecret: "demo-signing-secret-not-for-production",
    imageCodec: fakeImageCodec,
    bridges: {
      realtime: loggingRealtimeBridge((line) => {
        realtimeLog.push(line);
        log(line);
      }),
    },
  });

  const avatarKey = "avatars/user-42.png";

  // 2. Upload an avatar.
  log("1. Uploading avatar…");
  const original = makeAvatarBytes("original-avatar", 128);
  const uploaded = await storage.put(avatarKey, original, {
    contentType: "image/png",
    owner: "user-42",
  });
  log(`   uploaded ${uploaded.key} (${uploaded.size} bytes, etag=${uploaded.etag})\n`);

  // 3. Download it back and confirm the round-trip.
  log("2. Downloading avatar…");
  const got = await storage.get(avatarKey);
  if (!got.found || got.bytes === undefined) {
    throw new Error("demo failed: uploaded avatar could not be downloaded");
  }
  const downloadedMatches = Buffer.from(got.bytes).equals(Buffer.from(original));
  log(`   downloaded ${got.bytes.byteLength} bytes, matches upload: ${downloadedMatches}\n`);
  if (!downloadedMatches) {
    throw new Error("demo failed: downloaded avatar bytes did not match the upload");
  }

  // 4. Replace the avatar with new content (same key).
  log("3. Replacing avatar…");
  const replacement = makeAvatarBytes("replacement-avatar", 256);
  const replaced = await storage.put(avatarKey, replacement, {
    contentType: "image/png",
    owner: "user-42",
  });
  log(`   replaced ${replaced.key} → now ${replaced.size} bytes (etag=${replaced.etag})\n`);

  // 5. Upload a second object then list everything.
  log("4. Listing objects…");
  await storage.put("avatars/user-7.png", makeAvatarBytes("seven", 64), {
    contentType: "image/png",
    owner: "user-7",
  });
  const listed = await storage.list("avatars/");
  for (const item of listed) {
    log(`   • ${item.key} (${item.size} bytes)`);
  }
  log("");
  const listedKeys = listed.map((item) => item.key);

  // 6. Delete an object.
  log("5. Deleting an object…");
  const deletedKey = "avatars/user-7.png";
  await storage.delete(deletedKey);
  const stillThere = await storage.exists(deletedKey);
  log(`   deleted ${deletedKey}, still exists: ${stillThere}\n`);

  // 7. Generate a signed URL for the avatar.
  log("6. Generating a signed URL…");
  const url = await storage.signedUrl(avatarKey, "GET", { expiresInMs: 60_000 });
  log(`   signed URL: ${url}\n`);

  // 8. Show upload progress via putStream: the Realtime bridge logs the
  //    started/completed transitions, and the chunked stream reports byte-level
  //    progress through the callback below.
  log("7. Streaming upload with progress…");
  let progressUpdates = 0;
  const streamData = makeAvatarBytes("streamed-upload", 200);
  const stream = chunkedStream(streamData, 32, (transferred, total) => {
    progressUpdates += 1;
    log(`  [progress] ${transferred}/${total} bytes`);
  });
  const streamedKey = "avatars/user-42-streamed.png";
  const streamed = await storage.putStream(streamedKey, stream, {
    contentType: "image/png",
    owner: "user-42",
  });
  log(`   streamed ${streamed.key} (${streamed.size} bytes) in ${progressUpdates} chunks\n`);

  // 9. Resize the avatar image (through the fake codec).
  log("8. Resizing the avatar image…");
  const resized = await storage.images.transform(avatarKey, {
    resize: { width: 128, height: 128 },
    format: "webp",
  });
  log(`   resized variant: ${resized.key} (${resized.size} bytes, ${resized.contentType})\n`);

  // 10. Generate a thumbnail.
  log("9. Generating a thumbnail…");
  const thumbnail = await storage.images.transform(avatarKey, {
    thumbnail: { size: 32 },
    format: "png",
  });
  log(`   thumbnail variant: ${thumbnail.key} (${thumbnail.size} bytes, ${thumbnail.contentType})\n`);

  // 11. Inspect metadata for the avatar.
  log("10. Inspecting metadata…");
  const metadata = await storage.stat(avatarKey);
  if (metadata === null) {
    throw new Error("demo failed: avatar metadata could not be inspected");
  }
  log(
    `   ${metadata.key}: size=${metadata.size}, contentType=${metadata.contentType}, ` +
      `owner=${metadata.owner ?? "-"}, access=${metadata.accessLevel}, ` +
      `checksum=${metadata.checksum.slice(0, 12)}…`,
  );
  log(`   createdAt=${metadata.createdAt}, updatedAt=${metadata.updatedAt}\n`);

  // Surface the in-flight stats gathered along the way.
  const stats = storage.stats();
  log(
    `Stats: uploads=${stats.uploads}, downloads=${stats.downloads}, ` +
      `bytesUploaded=${stats.bytesUploaded}, storageUsage=${stats.storageUsage}`,
  );

  await storage.close();
  log("\n=== demo complete ===");

  return {
    downloaded: downloadedMatches ? "ok" : "mismatch",
    replaced: replaced.key,
    listedKeys,
    deletedKey,
    signedUrl: url,
    progressUpdates,
    resizedKey: resized.key,
    thumbnailKey: thumbnail.key,
    avatarSize: metadata.size,
  };
}

// Make the module runnable directly: `node dist/examples/storage-demo.js`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStorageDemo().catch((error: unknown) => {
    console.error("storage demo failed:", error);
    process.exitCode = 1;
  });
}
