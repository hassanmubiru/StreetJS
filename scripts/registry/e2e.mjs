#!/usr/bin/env node
// scripts/registry/e2e.mjs
//
// The Network Plugin Registry publish→install END-TO-END harness (Requirement
// 4.8). This is the real command executed (through `CommandRunner`) by
// verify.mjs. It is also runnable standalone for local debugging.
//
// What it does, mirroring the design's "publish → install" sequence:
//   1. Starts the @streetjs/registry server IN A CONTAINER (REGISTRY_IMAGE),
//      seeded with a single publisher that owns the `street` namespace, with the
//      repo mounted read-only so the container runs the built server + core.
//   2. Waits for the server to serve `/api/v1/plugins`.
//   3. Generates a publisher Ed25519 keypair, builds and signs a plugin
//      manifest with the core signing primitives (so the registry and the
//      harness agree byte-for-byte on what a valid signed manifest is).
//   4. PUBLISH: POST /api/v1/plugins with a bearer token (authn + authz +
//      Ed25519 verification on the server) — asserts 201 Created.
//   5. INSTALL: GET …/download, then performs the SAME consumer-side integrity
//      validation `street registry install` performs — manifest checksum,
//      Ed25519 signature, and byte-faithful tarball checksum — asserts all pass.
//   6. Asserts the registry's own verify endpoint agrees the version is valid.
//   7. Tears the container down.
//
// Exit code: 0 when the full publish→install round trip succeeds, non-zero when
// any step fails. When NO container runtime is available the harness prints a
// SKIP line and exits 0 — the driver's prerequisite probe is what records the
// honest BLOCKED status, so the offline suite stays green (Testing Strategy →
// Honest BLOCKED).
//
// _Design: Components → Network Plugin Registry (E2E harness); Testing Strategy
//  → Layer B. Requirements: 4.8_

import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { signManifest, verifyManifest, manifestChecksum } from 'streetjs';
import {
  REGISTRY_IMAGE,
  REPO_ROOT,
  CONTAINER_PORT,
  probeContainerPrerequisites,
  findFreePort,
  waitForHttp,
  docker,
} from './lib.mjs';

const PUBLISHER_TOKEN = 'street-e2e-publisher-token';
const PLUGIN_NAME = 'street/e2e-demo';
const PLUGIN_VERSION = '1.0.0';

/** Build, sign, and return a fully valid manifest under the `street` namespace. */
function buildSignedManifest(privateKey) {
  const manifest = {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    capabilities: ['demo'],
    permissions: [],
    dependencies: {},
  };
  return signManifest(manifest, privateKey);
}

/** Start the registry server container; returns the container name + base URL. */
async function startContainer() {
  const port = await findFreePort();
  const name = `street-registry-e2e-${process.pid}`;
  const publishers = JSON.stringify([
    { id: 'street-official', apiKey: PUBLISHER_TOKEN, namespaces: ['street'] },
  ]);

  // Run detached, repo mounted read-only (the registry stores in memory, so no
  // writable mount is needed), publisher seeded via env. `streetjs` resolves
  // through the repo's node_modules symlink to packages/core.
  const run = docker([
    'run', '--rm', '-d',
    '--name', name,
    '-p', `127.0.0.1:${port}:${CONTAINER_PORT}`,
    '-v', `${REPO_ROOT}:/app:ro`,
    '-w', '/app',
    '-e', `PORT=${CONTAINER_PORT}`,
    '-e', 'HOST=0.0.0.0',
    '-e', `STREET_REGISTRY_PUBLISHERS=${publishers}`,
    REGISTRY_IMAGE,
    'node', 'packages/registry-server/dist/cli.js',
  ]);

  if (!run.ok) {
    throw new Error(`failed to start registry container: ${run.stderr || run.stdout}`);
  }
  return { name, baseUrl: `http://127.0.0.1:${port}`, apiBase: `http://127.0.0.1:${port}/api/v1` };
}

/** Stop the container (best-effort) and dump its logs on failure for diagnosis. */
function stopContainer(name, { dumpLogs = false } = {}) {
  if (dumpLogs) {
    const logs = docker(['logs', name], { timeoutMs: 15_000 });
    if (logs.stdout) console.error(`[registry-e2e] container logs:\n${logs.stdout}`);
    if (logs.stderr) console.error(`[registry-e2e] container stderr:\n${logs.stderr}`);
  }
  docker(['stop', '-t', '3', name], { timeoutMs: 30_000 });
}

/** Assert a condition; throws a labelled Error when it does not hold. */
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function runE2E() {
  const { name, apiBase } = await startContainer();
  let ok = false;
  try {
    // Step 2 — wait for the server to route `/api/v1/plugins`.
    const up = await waitForHttp(`${apiBase}/plugins`, { timeoutMs: 60_000 });
    assert(up, 'registry server did not become reachable within 60s');

    // Step 3 — publisher keypair + signed manifest.
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const signed = buildSignedManifest(privateKey);
    const tarball = Buffer.from('street-e2e-plugin-tarball-payload');
    const tarballBase64 = tarball.toString('base64');

    // Step 4 — PUBLISH (authn + authz + Ed25519 verification on the server).
    const publishRes = await fetch(`${apiBase}/plugins`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${PUBLISHER_TOKEN}` },
      body: JSON.stringify({ manifest: signed, publicKeyPem, tarballBase64, categories: ['demo'], tags: ['e2e'] }),
    });
    const publishBody = await publishRes.json().catch(() => ({}));
    assert(
      publishRes.status === 201,
      `publish expected 201, got ${publishRes.status}: ${JSON.stringify(publishBody)}`,
    );
    assert(publishBody.name === PLUGIN_NAME && publishBody.version === PLUGIN_VERSION, 'publish response identity mismatch');
    console.log(`[registry-e2e] published ${publishBody.name}@${publishBody.version}`);

    // Step 5 — INSTALL: download + consumer-side integrity validation (Req 4.3).
    const dlRes = await fetch(`${apiBase}/plugins/${PLUGIN_NAME.split('/').map(encodeURIComponent).join('/')}/${PLUGIN_VERSION}/download`);
    assert(dlRes.ok, `download expected ok, got ${dlRes.status}`);
    const pkg = await dlRes.json();

    const consumerKey = createPublicKey(pkg.publicKeyPem);
    const checksumOk = pkg.manifest.checksum === manifestChecksum(pkg.manifest);
    const signatureOk = verifyManifest(pkg.manifest, consumerKey);
    const downloadedBytes = Buffer.from(pkg.tarballBase64, 'base64');
    const tarballOk = createHash('sha256').update(downloadedBytes).digest('hex') === pkg.tarballChecksum;

    assert(checksumOk, 'consumer-side manifest checksum verification failed');
    assert(signatureOk, 'consumer-side Ed25519 signature verification failed');
    assert(tarballOk, 'consumer-side tarball checksum verification failed');
    assert(downloadedBytes.equals(tarball), 'downloaded tarball bytes are not byte-faithful');
    console.log('[registry-e2e] installed + verified (manifest checksum + Ed25519 signature + tarball checksum)');

    // Step 6 — the registry's own verify endpoint agrees.
    const verifyRes = await fetch(`${apiBase}/plugins/${PLUGIN_NAME.split('/').map(encodeURIComponent).join('/')}/${PLUGIN_VERSION}/verify`);
    const verifyBody = await verifyRes.json().catch(() => ({}));
    assert(verifyRes.ok && verifyBody.valid === true, `registry verify endpoint disagreed: ${JSON.stringify(verifyBody)}`);

    ok = true;
    console.log('[registry-e2e] publish→install E2E succeeded');
  } finally {
    stopContainer(name, { dumpLogs: !ok });
  }
}

async function main() {
  // When no container runtime is available, SKIP cleanly (exit 0). The driver's
  // prerequisite probe records the honest BLOCKED status for the artifact.
  const missing = probeContainerPrerequisites();
  if (missing) {
    console.log(`[registry-e2e] SKIP — container unavailable: ${missing.kind}/${missing.missingPrerequisite}`);
    process.exitCode = 0;
    return;
  }

  try {
    await runE2E();
    process.exitCode = 0;
  } catch (err) {
    console.error(`[registry-e2e] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}

export { buildSignedManifest, PLUGIN_NAME, PLUGIN_VERSION, PUBLISHER_TOKEN };
