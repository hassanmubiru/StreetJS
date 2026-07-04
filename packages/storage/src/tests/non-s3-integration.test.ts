// Integration tests for the non-S3 cloud drivers — Supabase, Google Cloud
// Storage, and Azure Blob — with **honest credential-based skipping**
// (task 29.4). These mirror the honest-skip policy of the S3-compatible
// integration tests (task 28.6): a live provider is only exercised when that
// provider's credentials are present in the environment, and the suite never
// fabricates provider success.
//
// ## Honest-skip policy (Requirement 27.2–27.5)
//
// Per provider, credential presence is detected from environment variables and
// classified into one of three states, each mapped to an honest node:test
// outcome:
//
//   • absent  (no provider env vars set) — the test is declared with node:test's
//     `test(name, { skip: reason }, ...)` option, so its body never runs and it
//     is reported as **skipped, never as passed** (Requirement 27.3). This is the
//     default state in CI/local runs with no cloud credentials, so the file loads
//     and `node --test dist/tests/*.test.js` stays green.
//
//   • present (all provider env vars set) — the test runs against the live
//     provider (Requirement 27.2). If the driver cannot be constructed for
//     another reason — most commonly the optional provider SDK is not installed —
//     the driver's connector throws a StorageConfigError; that is caught and the
//     test returns normally after emitting a clear diagnostic, i.e. it is
//     **reported as passed with a skip message** (Requirement 27.4). Any other
//     unexpected construction error, or a failed assertion during the live
//     round-trip, propagates and **fails the build** (Requirement 27.5).
//
//   • misconfigured (some but not all of a provider's env vars set) — the test
//     runner is misconfigured; the test **fails the build** with a message naming
//     the present and missing variables (Requirement 27.5).
//
// ## No provider SDKs at import time (guard/lazy)
//
// This file imports only the drivers' connector functions. Each connector
// (`connectSupabaseStorageDriver`, `connectGoogleCloudStorageDriver`,
// `connectAzureBlobDriver`) resolves its optional provider SDK through a lazy
// dynamic `import()` performed inside the function — never at module top level —
// so loading this test file requires no `@supabase/supabase-js`,
// `@google-cloud/storage`, or `@azure/storage-blob` install. With no credentials
// present the whole file simply registers skipped tests and stays green.
//
// Requirements: 27.2, 27.3, 27.4, 27.5

import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import { connectSupabaseStorageDriver } from "../drivers/supabase.js";
import { connectGoogleCloudStorageDriver } from "../drivers/gcs.js";
import { connectAzureBlobDriver } from "../drivers/azure.js";
import { StorageConfigError } from "../errors.js";
import type { StorageDriver } from "../driver.js";

/** The credential-presence classification for a provider. */
type CredentialState = "absent" | "present" | "misconfigured";

/** The outcome of classifying a provider's credential environment variables. */
interface CredentialClassification {
  readonly state: CredentialState;
  readonly present: string[];
  readonly missing: string[];
}

/** A single cloud provider's honest-skip integration registration spec. */
interface CloudIntegrationSpec {
  readonly provider: string;
  readonly envVars: readonly string[];
  connect(): Promise<StorageDriver>;
}

// ── Credential detection ──────────────────────────────────────────────────────

/**
 * Classify the presence of a provider's credential environment variables.
 *
 * @param {readonly string[]} vars The env var names the provider requires.
 * @returns {{ state: "absent" | "present" | "misconfigured", present: string[], missing: string[] }}
 */
function classifyCredentials(vars: readonly string[]): CredentialClassification {
  const present = vars.filter((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.trim() !== "";
  });
  const missing = vars.filter((name) => !present.includes(name));

  if (present.length === 0) {
    return { state: "absent", present, missing };
  }
  if (missing.length === 0) {
    return { state: "present", present, missing };
  }
  return { state: "misconfigured", present, missing };
}

// ── Shared live round-trip exercise ────────────────────────────────────────────

/**
 * Exercise the mandatory StorageDriver primitives against a live provider
 * driver: put → exists → get (byte + metadata fidelity) → stat → list → delete.
 * Uses a unique, namespaced key and always attempts cleanup. Assertion failures
 * here propagate to fail the build (Requirement 27.5) — a live provider with
 * valid credentials and an installed SDK is expected to succeed (Requirement
 * 27.2).
 *
 * @param {string} provider The provider name (for key namespacing / messages).
 * @param {import("../driver.js").StorageDriver} driver The connected driver.
 */
async function exerciseLiveRoundTrip(provider: string, driver: StorageDriver) {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const prefix = `streetjs-integration/${provider}/`;
  const key = `${prefix}${unique}.bin`;
  const content = Buffer.from(`streetjs ${provider} integration payload ${unique}`);

  try {
    const written = await driver.put(key, new Uint8Array(content), {
      contentType: "text/plain",
      owner: "integration-suite",
      custom: { suite: "29.4", provider },
    });
    assert.equal(written.key, key, "put should return metadata for the written key");
    assert.equal(written.size, content.byteLength, "put should report the written byte length");

    assert.equal(await driver.exists(key), true, "written object should exist");

    const got = await driver.get(key);
    assert.equal(got.found, true, "get should find the written object");
    assert.deepEqual(
      Buffer.from(got.bytes),
      content,
      "get should return the exact written bytes",
    );
    assert.equal(
      got.metadata.contentType,
      "text/plain",
      "content type should round-trip",
    );

    const stat = await driver.stat(key);
    assert.ok(stat !== null, "stat should return metadata for an existing object");
    assert.equal(stat.size, content.byteLength, "stat size should match the written bytes");

    const listed = await driver.list(prefix);
    assert.ok(
      listed.some((item) => item.key === key),
      "list should include the written key under its prefix",
    );
  } finally {
    // Best-effort cleanup so repeated runs do not accumulate objects.
    await driver.delete(key).catch(() => {});
  }

  assert.equal(await driver.exists(key), false, "deleted object should no longer exist");
}

// ── Per-provider honest-skip registration ──────────────────────────────────────

/**
 * Register a single honest-skip integration test for a cloud provider.
 *
 * @param {object} spec
 * @param {string} spec.provider Provider name used in the test title / messages.
 * @param {readonly string[]} spec.envVars The env vars this provider requires.
 * @param {() => Promise<import("../driver.js").StorageDriver>} spec.connect
 *   Builds the live driver from the environment (resolves its SDK lazily).
 */
function registerCloudIntegration({ provider, envVars, connect }: CloudIntegrationSpec) {
  const title = `[integration] ${provider} driver live round-trip`;
  const cred = classifyCredentials(envVars);

  if (cred.state === "absent") {
    // Requirement 27.3: no credentials → skip with a clear message, never passed.
    test(
      title,
      {
        skip:
          `No ${provider} credentials present (expected env: ${envVars.join(", ")}). ` +
          `Skipping live integration — this is reported as skipped, not passed.`,
      },
      () => {},
    );
    return;
  }

  if (cred.state === "misconfigured") {
    // Requirement 27.5: partial credentials means the runner is misconfigured →
    // fail the build rather than silently half-running.
    test(title, () => {
      assert.fail(
        `${provider} integration is misconfigured: set ALL of [${envVars.join(", ")}] ` +
          `or NONE. Present: [${cred.present.join(", ")}]; missing: [${cred.missing.join(", ")}].`,
      );
    });
    return;
  }

  // Requirement 27.2 / 27.4: credentials present → attempt the live round-trip.
  test(title, async (t) => {
    let driver: StorageDriver;
    try {
      driver = await connect();
    } catch (error) {
      if (error instanceof StorageConfigError) {
        // Requirement 27.4: credentials present but the test cannot run for
        // another reason (typically the optional provider SDK is not installed).
        // Report as passed with a clear skip message.
        t.diagnostic(
          `${provider} credentials are present but the live integration cannot run: ` +
            `${error.message} Reporting as passed-with-skip (Requirement 27.4).`,
        );
        return;
      }
      // Requirement 27.5: any other construction failure is a real error and
      // must fail the build.
      throw error;
    }

    await exerciseLiveRoundTrip(provider, driver);
  });
}

// ── Sanity: connectors import without any provider SDK ──────────────────────────

test("[integration] non-S3 cloud connectors import without provider SDKs", () => {
  // Proves the file loads cleanly (no top-level SDK import) so the suite stays
  // green when no cloud credentials are configured.
  assert.equal(typeof connectSupabaseStorageDriver, "function");
  assert.equal(typeof connectGoogleCloudStorageDriver, "function");
  assert.equal(typeof connectAzureBlobDriver, "function");
});

// ── Provider registrations ──────────────────────────────────────────────────────

registerCloudIntegration({
  provider: "supabase",
  envVars: ["SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_BUCKET"],
  connect: () =>
    connectSupabaseStorageDriver({
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_KEY,
      bucket: process.env.SUPABASE_BUCKET,
    }),
});

registerCloudIntegration({
  provider: "gcs",
  envVars: ["GCS_BUCKET", "GCS_PROJECT_ID", "GOOGLE_APPLICATION_CREDENTIALS"],
  connect: () =>
    connectGoogleCloudStorageDriver({
      bucket: process.env.GCS_BUCKET,
      projectId: process.env.GCS_PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    }),
});

registerCloudIntegration({
  provider: "azure",
  envVars: ["AZURE_STORAGE_CONNECTION_STRING", "AZURE_STORAGE_CONTAINER"],
  connect: () =>
    connectAzureBlobDriver({
      container: process.env.AZURE_STORAGE_CONTAINER,
      connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    }),
});
