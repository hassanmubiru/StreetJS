// Integration tests for the S3-compatible cloud drivers (task 28.6): Amazon S3,
// Cloudflare R2, MinIO, and Backblaze B2. These are *live* provider tests that
// talk to a real bucket, so they follow the "honest external skipping" policy
// from Requirement 27 — they never fabricate provider success and never report a
// skipped provider as passed.
//
// Behavior matrix (Requirements 27.2–27.5):
//
//   • Credentials ABSENT  → the test is declared with node:test's
//       test(name, { skip: reason }, ...) so the runner marks it SKIPPED (not
//       passed) and never executes any provider code. This is the normal CI case
//       here: with no credentials the file loads and every provider test skips
//       cleanly, so `node --test dist/tests/*.test.js` stays green. (27.3)
//
//   • Credentials PRESENT → the test runs against the provider: it constructs the
//       driver from configuration and performs an upload/download/delete
//       round-trip, asserting the downloaded bytes equal the uploaded bytes. (27.2)
//
//   • Credentials PRESENT but the run cannot proceed for another reason (for
//       example the optional provider SDK is not installed, or the client cannot
//       be constructed) → the running test calls t.skip(reason), which reports it
//       as skipped with a clear message rather than a failure: "passed with a
//       clear skip message". (27.4)
//
//   • Runner MISCONFIGURED → when a provider's credentials are only *partially*
//       supplied (some required environment variables set, others missing) the
//       configuration is inconsistent. That is a misconfigured runner, so the
//       test FAILS and fails the build rather than silently skipping. (27.5)
//
// SDK isolation: this file imports no provider SDK and no driver module at import
// time. The driver factories (which themselves resolve any optional SDK lazily)
// are pulled in with a dynamic import() only when credentials are present, so the
// module always loads even though none of the @aws-sdk / minio peers are
// installed in this workspace.
//
// Requirements: 27.2, 27.3, 27.4, 27.5

import test from "node:test";
import assert from "node:assert/strict";

/**
 * Read the first non-empty value among a list of candidate environment variable
 * names. Returns `undefined` when none are set to a non-empty string.
 */
function readEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}

/**
 * Descriptors for every S3-compatible provider under test. Each declares the
 * required credential fields (with their accepted environment-variable names),
 * any optional fields, and an async `connect(values)` that builds a driver from
 * the resolved configuration by lazily importing its submodule.
 */
const PROVIDERS = [
  {
    label: "S3",
    required: {
      bucket: ["STREETJS_S3_BUCKET"],
      region: ["STREETJS_S3_REGION", "AWS_REGION", "AWS_DEFAULT_REGION"],
      accessKeyId: ["STREETJS_S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"],
      secretAccessKey: ["STREETJS_S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"],
    },
    optional: {
      endpoint: ["STREETJS_S3_ENDPOINT"],
    },
    async connect(v) {
      const { createS3StorageDriverFromConfig } = await import("../drivers/s3.js");
      return createS3StorageDriverFromConfig({
        bucket: v.bucket,
        region: v.region,
        endpoint: v.endpoint,
        credentials: {
          accessKeyId: v.accessKeyId,
          secretAccessKey: v.secretAccessKey,
        },
      });
    },
  },
  {
    label: "R2",
    required: {
      accountId: ["STREETJS_R2_ACCOUNT_ID", "R2_ACCOUNT_ID"],
      bucket: ["STREETJS_R2_BUCKET", "R2_BUCKET"],
      accessKeyId: ["STREETJS_R2_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"],
      secretAccessKey: ["STREETJS_R2_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY"],
    },
    optional: {
      endpoint: ["STREETJS_R2_ENDPOINT", "R2_ENDPOINT"],
    },
    async connect(v) {
      const { connectCloudflareR2Driver } = await import("../drivers/r2.js");
      return connectCloudflareR2Driver({
        accountId: v.accountId,
        bucket: v.bucket,
        accessKeyId: v.accessKeyId,
        secretAccessKey: v.secretAccessKey,
        endpoint: v.endpoint,
      });
    },
  },
  {
    label: "MinIO",
    required: {
      endPoint: ["STREETJS_MINIO_ENDPOINT", "MINIO_ENDPOINT"],
      bucket: ["STREETJS_MINIO_BUCKET", "MINIO_BUCKET"],
      accessKey: ["STREETJS_MINIO_ACCESS_KEY", "MINIO_ACCESS_KEY", "MINIO_ROOT_USER"],
      secretKey: ["STREETJS_MINIO_SECRET_KEY", "MINIO_SECRET_KEY", "MINIO_ROOT_PASSWORD"],
    },
    optional: {
      port: ["STREETJS_MINIO_PORT", "MINIO_PORT"],
      useSSL: ["STREETJS_MINIO_USE_SSL", "MINIO_USE_SSL"],
      region: ["STREETJS_MINIO_REGION", "MINIO_REGION"],
    },
    async connect(v) {
      const { connectMinIODriver } = await import("../drivers/minio.js");
      return connectMinIODriver({
        endPoint: v.endPoint,
        bucket: v.bucket,
        accessKey: v.accessKey,
        secretKey: v.secretKey,
        port: v.port !== undefined ? Number(v.port) : undefined,
        useSSL: v.useSSL !== undefined ? v.useSSL !== "false" : undefined,
        region: v.region,
      });
    },
  },
  {
    label: "Backblaze",
    required: {
      endpoint: ["STREETJS_B2_ENDPOINT", "B2_ENDPOINT"],
      bucket: ["STREETJS_B2_BUCKET", "B2_BUCKET"],
      accessKeyId: ["STREETJS_B2_KEY_ID", "B2_KEY_ID", "B2_APPLICATION_KEY_ID"],
      secretAccessKey: ["STREETJS_B2_APPLICATION_KEY", "B2_APPLICATION_KEY"],
    },
    optional: {
      region: ["STREETJS_B2_REGION", "B2_REGION"],
    },
    async connect(v) {
      const { createBackblazeB2Driver } = await import("../drivers/backblaze.js");
      return createBackblazeB2Driver({
        endpoint: v.endpoint,
        bucket: v.bucket,
        region: v.region,
        credentials: {
          accessKeyId: v.accessKeyId,
          secretAccessKey: v.secretAccessKey,
        },
      });
    },
  },
];

/**
 * Resolve a provider's configuration from the environment and classify the
 * result as one of:
 *   - "absent"        → none of the required fields are set
 *   - "present"       → every required field is set
 *   - "misconfigured" → some (but not all) required fields are set
 *
 * Returns the classification, the resolved values (including optional fields),
 * and the human-readable list of accepted env-var names used in skip/fail
 * messages.
 */
function classifyProvider(provider) {
  const values = {};
  const requiredNames = [];
  let resolvedCount = 0;
  const total = Object.keys(provider.required).length;

  for (const [field, names] of Object.entries(provider.required)) {
    requiredNames.push(names[0]);
    const value = readEnv(names);
    if (value !== undefined) {
      values[field] = value;
      resolvedCount += 1;
    }
  }
  for (const [field, names] of Object.entries(provider.optional ?? {})) {
    const value = readEnv(names);
    if (value !== undefined) {
      values[field] = value;
    }
  }

  let classification;
  if (resolvedCount === 0) {
    classification = "absent";
  } else if (resolvedCount === total) {
    classification = "present";
  } else {
    classification = "misconfigured";
  }

  return { classification, values, requiredNames, resolvedCount, total };
}

/**
 * Upload/download/delete round-trip asserting byte fidelity. Cleans up the test
 * object on a best-effort basis so live buckets are not left with test data.
 */
async function runRoundTrip(driver) {
  const key = `streetjs-integration/${Date.now()}-${Math.random().toString(16).slice(2)}.bin`;
  const content = new TextEncoder().encode(
    `streetjs storage integration round-trip ${new Date().toISOString()}`,
  );

  try {
    await driver.put(key, content, { contentType: "application/octet-stream" });

    const exists = await driver.exists(key);
    assert.equal(exists, true, "object must exist after put");

    const got = await driver.get(key);
    assert.equal(got.found, true, "object must be found after put");
    assert.deepEqual(got.bytes, content, "downloaded bytes must equal uploaded bytes");
  } finally {
    try {
      await driver.delete(key);
    } catch {
      // Best-effort cleanup; a delete failure must not mask the assertion result.
    }
  }
}

// ── Register one integration test per provider, honestly classified ────────────

for (const provider of PROVIDERS) {
  const { classification, values, requiredNames } = classifyProvider(provider);
  const testName = `[integration] ${provider.label}: upload/download preserves bytes`;

  if (classification === "absent") {
    // Requirement 27.3 — no credentials: skip with a clear message. Declared via
    // the { skip } option so node:test marks it SKIPPED (never passed) and no
    // provider code runs.
    test(
      testName,
      {
        skip:
          `No ${provider.label} credentials present in the environment ` +
          `(set ${requiredNames.join(", ")} to run this integration test).`,
      },
      () => {},
    );
    continue;
  }

  if (classification === "misconfigured") {
    // Requirement 27.5 — partial credentials are a misconfigured runner: FAIL so
    // the build fails rather than silently skipping an inconsistent setup.
    test(testName, () => {
      assert.fail(
        `${provider.label} integration is misconfigured: some but not all required ` +
          `credentials are set. Provide all of [${requiredNames.join(", ")}] to run, ` +
          `or none to skip.`,
      );
    });
    continue;
  }

  // Requirement 27.2 — credentials present: run against the provider.
  test(testName, async (t) => {
    let driver;
    try {
      driver = await provider.connect(values);
    } catch (error) {
      // Requirement 27.4 — present but cannot run for another reason (e.g. the
      // optional SDK is not installed, or the client cannot be constructed):
      // report passed-with-skip via t.skip rather than failing the build.
      const reason = error instanceof Error ? error.message : String(error);
      t.skip(
        `${provider.label} credentials are present but the driver could not be ` +
          `constructed, so the integration test cannot run: ${reason}`,
      );
      return;
    }

    await runRoundTrip(driver);
  });
}
