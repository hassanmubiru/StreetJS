// Property-based test for the resumable upload equivalence guarantee.
//
// Property 10 (Resumable equals uninterrupted): for arbitrary content, a
// resumable upload — optionally interrupted partway (a first `resumeUpload`
// whose source stream errors after emitting a prefix) and then resumed with the
// object's full content — produces an object byte-identical to an equivalent
// single, uninterrupted `put` of the same content on a separate store. The
// upload is driven through `startUpload` → (optional failing `resumeUpload`) →
// `resumeUpload(full stream)`; the resulting bytes and checksum are compared
// against a plain `put` on an independent `memory` store.
//
// This exercises the facade's ResumableManager over the zero-dependency
// `memory` provider, driving the identical offset-tracked resume code path
// every provider shares (Requirements 7.2, 7.3), and asserts the cross-path
// determinism the framework guarantees (Requirement 26.5).
//
// Uses the Node.js built-in test runner (node:test) with fast-check for input
// generation, executed via `node --test dist/tests/*.test.js`. fast-check is
// configured with { numRuns: 100 } per the design's property-testing contract.
//
// Feature: unified-storage-framework, Property 10: Resumable equals uninterrupted
//
// Validates: Requirements 7.2, 7.3, 26.5

import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { Buffer } from "node:buffer";

import fc from "fast-check";

import { createStorage } from "../facade.js";

test(
  "Feature: unified-storage-framework, Property 10: Resumable equals uninterrupted",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.uint8Array(),
        // `interrupt` decides whether the upload is interrupted before its
        // final resume; `prefixLen` (bounded to the content) picks how many
        // bytes the interrupted resume persists before erroring.
        fc.boolean(),
        fc.nat(),
        async (key, content, interrupt, prefixLen) => {
          const payload = Buffer.from(content);

          // The resumable store: start a session, optionally interrupt, then
          // resume with the FULL content.
          const resumableStore = createStorage({ provider: "memory" });
          const sessionId = await resumableStore.startUpload(key, {});

          if (interrupt && payload.byteLength > 0) {
            // Emit a prefix of the content then error partway, simulating a
            // network interruption. Only the prefix is persisted (Req 7.2).
            const cut = prefixLen % payload.byteLength;
            const prefix = payload.subarray(0, cut);
            const failing = new Readable({
              read() {
                if (prefix.byteLength > 0) {
                  this.push(prefix);
                }
                this.destroy(new Error("network interruption"));
              },
            });
            await assert.rejects(
              () => resumableStore.resumeUpload(sessionId, failing),
              /network interruption/,
            );
            // No final object exists yet after an interrupted resume.
            assert.equal(await resumableStore.exists(key), false);
          }

          // Resume with the full content: the manager appends only the bytes
          // beyond the persisted offset and completes (Req 7.3).
          const resumedMeta = await resumableStore.resumeUpload(
            sessionId,
            Readable.from([payload]),
          );

          // The reference store: a single, uninterrupted put of the same bytes.
          const referenceStore = createStorage({ provider: "memory" });
          const singleMeta = await referenceStore.put(key, new Uint8Array(payload), {});

          // Byte-identical object: same size and checksum as the single put.
          assert.equal(resumedMeta.size, singleMeta.size);
          assert.equal(resumedMeta.checksum, singleMeta.checksum);

          // And the stored bytes read back equal on both stores.
          const resumedGet = await resumableStore.get(key);
          const referenceGet = await referenceStore.get(key);
          assert.equal(resumedGet.found, true);
          assert.equal(referenceGet.found, true);
          assert.deepEqual(Buffer.from(resumedGet.bytes), payload);
          assert.deepEqual(Buffer.from(resumedGet.bytes), Buffer.from(referenceGet.bytes));
        },
      ),
      { numRuns: 100 },
    );
  },
);
