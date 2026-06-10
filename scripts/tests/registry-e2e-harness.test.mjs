// scripts/tests/registry-e2e-harness.test.mjs
//
// Unit tests for the Network Plugin Registry publish→install E2E harness
// (Requirement 4.8). These exercise the harness's pure, container-free logic:
//
//   • buildSignedManifest produces a manifest the core primitives accept as
//     valid (checksum matches its body, Ed25519 signature verifies) — this is
//     exactly what the real harness publishes, so a regression here would mean a
//     publish that the registry rightly rejects.
//   • the container-runtime prerequisite probe returns either `null` (a usable
//     runtime) or a well-formed BlockedReason `{ missingPrerequisite, kind }` —
//     the shape the runner needs to record an honest BLOCKED.
//   • findFreePort yields a bindable loopback port.
//
// The full container round trip (start server → publish → install → verify) is
// Layer B and is covered by the registry.publish-install Verification Artifact
// produced through CommandRunner; it is intentionally NOT run here so the unit
// suite stays green without a container runtime.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';

import { verifyManifest, manifestChecksum } from 'streetjs';
import { buildSignedManifest, PLUGIN_NAME, PLUGIN_VERSION } from '../registry/e2e.mjs';
import { probeContainerPrerequisites, findFreePort, REGISTRY_IMAGE } from '../registry/lib.mjs';

describe('registry publish→install harness — pure logic', () => {
  it('buildSignedManifest produces a manifest that passes core Ed25519 + checksum verification', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const manifest = buildSignedManifest(privateKey);

    assert.equal(manifest.name, PLUGIN_NAME, 'manifest name should be the demo plugin');
    assert.equal(manifest.version, PLUGIN_VERSION, 'manifest version should be set');
    assert.equal(manifest.name.split('/')[0], 'street', 'name must sit under the seeded `street` namespace');

    // The checksum is the canonical-body SHA-256, and the signature verifies.
    assert.equal(manifest.checksum, manifestChecksum(manifest), 'checksum must match the canonical body');
    assert.equal(typeof manifest.signature, 'string');
    assert.ok(manifest.signature.length > 0, 'signature must be present');

    const pub = createPublicKey(publicKey.export({ type: 'spki', format: 'pem' }).toString());
    assert.equal(verifyManifest(manifest, pub), true, 'signature must verify against the signer public key');
  });

  it('buildSignedManifest signatures do NOT verify against an unrelated key (soundness)', () => {
    const signer = generateKeyPairSync('ed25519');
    const stranger = generateKeyPairSync('ed25519');
    const manifest = buildSignedManifest(signer.privateKey);

    assert.equal(
      verifyManifest(manifest, stranger.publicKey),
      false,
      'a manifest signed by one key must not verify under a different key',
    );
  });

  it('probeContainerPrerequisites returns null or a well-formed BlockedReason', () => {
    const result = probeContainerPrerequisites();
    if (result === null) return; // a usable container runtime is present

    assert.equal(typeof result.missingPrerequisite, 'string');
    assert.ok(result.missingPrerequisite.length > 0, 'missing prerequisite id must be non-empty');
    assert.ok(['runtime', 'service'].includes(result.kind), `kind must be runtime|service, got ${result.kind}`);
    // The id is one of the declared container prerequisites.
    assert.ok(
      result.missingPrerequisite === 'docker' ||
        result.missingPrerequisite === 'docker-daemon' ||
        result.missingPrerequisite === `docker-image:${REGISTRY_IMAGE}`,
      `unexpected prerequisite id: ${result.missingPrerequisite}`,
    );
  });

  it('findFreePort returns a usable ephemeral port', async () => {
    const port = await findFreePort();
    assert.equal(typeof port, 'number');
    assert.ok(port > 0 && port < 65536, `port out of range: ${port}`);
  });
});
