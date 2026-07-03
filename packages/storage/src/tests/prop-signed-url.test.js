// Property-based test for the storage facade's signed URL expiry guarantee.
//
// Property 11 (Signed URL expiry is honored): for an arbitrary key, operation
// (GET/PUT/DELETE), and expiry window, a signed URL minted at time T with
// `expiresInMs = E` verifies as VALID for its authorized operation when checked
// at any instant strictly before `T + E`, and verifies as INVALID with reason
// `'expired'` when checked at any instant at or after `T + E`.
//
// Time is made deterministic with an injected, controllable clock passed to
// `createStorage({ provider: 'memory', signingSecret, clock })`. The facade
// mints the URL over the zero-dependency memory provider (which has no native
// signed-URL capability, so the HMAC simulation path runs). A second
// `SignedUrlService` constructed with the SAME signing secret verifies the URL
// at an explicit check time via its `verify(url, op, now)` path, exercising the
// same code every provider shares (Requirements 8.1, 8.3, 8.4, 26.6).
//
// Uses the Node.js built-in test runner (node:test) with fast-check for input
// generation, executed via `node --test dist/tests/*.test.js`, configured with
// { numRuns: 100 } per the design's property-testing contract.
//
// Feature: unified-storage-framework, Property 11: Signed URL expiry is honored
//
// Validates: Requirements 8.1, 8.3, 8.4, 26.6

import test from "node:test";
import assert from "node:assert/strict";

import fc from "fast-check";

import { createStorage } from "../facade.js";
import { SignedUrlService } from "../signed-url.js";

const SIGNING_SECRET = "prop-11-signing-secret";

test(
  "Feature: unified-storage-framework, Property 11: Signed URL expiry is honored",
  async () => {
    await fc.assert(
      fc.asyncProperty(
        // An arbitrary object key.
        fc.string(),
        // The single operation the URL authorizes (Requirement 8.1).
        fc.constantFrom("GET", "PUT", "DELETE"),
        // The mint instant T as epoch milliseconds.
        fc.integer({ min: 0, max: 2 ** 40 }),
        // A strictly-positive expiry window E, so the URL is valid at mint time.
        fc.integer({ min: 1, max: 2 ** 32 }),
        // An offset relative to the expiry instant (T + E). A negative offset
        // lands strictly before expiry (must be VALID); a non-negative offset
        // lands at or after expiry (must be 'expired'). The range straddles zero
        // so both branches are exercised across the 100 runs.
        fc.integer({ min: -(2 ** 20), max: 2 ** 20 }),
        async (key, op, mintTime, expiresInMs, offsetFromExpiry) => {
          // A controllable clock so minting stamps expiry as T + E deterministically.
          let now = mintTime;
          const clock = () => now;

          const storage = createStorage({
            provider: "memory",
            signingSecret: SIGNING_SECRET,
            clock,
          });

          // Mint through the facade at time T; expiry = T + E.
          const url = await storage.signedUrl(key, op, { expiresInMs });
          const expiry = mintTime + expiresInMs;

          // Independent verifier sharing only the secret; the check time is
          // supplied explicitly so expiry is driven deterministically.
          const verifier = new SignedUrlService({ signingSecret: SIGNING_SECRET });

          const checkTime = expiry + offsetFromExpiry;
          const verification = verifier.verify(url, op, checkTime);

          if (checkTime < expiry) {
            // Strictly before T + E: the URL is valid for its authorized op.
            assert.equal(verification.valid, true);
            assert.equal(verification.key, key);
            assert.equal(verification.op, op);
          } else {
            // At or after T + E: the URL is invalid, specifically 'expired'.
            assert.equal(verification.valid, false);
            assert.equal(verification.reason, "expired");
          }
        },
      ),
      { numRuns: 100 },
    );
  },
);
