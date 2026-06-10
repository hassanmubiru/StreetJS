// tests/plugin-install-registry.test.ts
// Verifies install-through-registry with signature verification ENFORCED by the
// PluginHost (Req 5.6 / 5.7 / 5.8):
//   - a valid signed plugin installs in < 60s and registers (5.6)
//   - a bad signature is rejected with PluginSignatureError, the installed set
//     is left unchanged, and the plugin is never registered (5.7)
//   - a missing or malformed manifest is rejected with an identifying error (5.8)
// Offline only.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  PluginHost, signManifest,
  PluginSignatureError, PluginError, PluginManifestError,
  type PluginManifest,
} from '../platform/plugins/host.js';
import {
  LocalPluginRegistry, installThroughRegistry, assertWellFormedManifest,
} from '../platform/plugins/local-registry.js';
import { S3Plugin, s3PluginManifest, S3_PLUGIN_NAME } from '../platform/plugins/official/s3.js';

const s3Config = {
  bucket: 'b', region: 'us-east-1', accessKeyId: 'AKIA', secretAccessKey: 'sk',
};

function ed25519() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey, privateKey,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('install through registry — valid signed plugin (Req 5.6)', () => {
  it('installs in < 60s and registers the plugin', async () => {
    const signer = ed25519();
    const reg = new LocalPluginRegistry();
    reg.publish(signManifest(s3PluginManifest(), signer.privateKey), signer.publicPem);

    // Host enforces signatures against the SAME (trusted) key the plugin was signed with.
    const host = new PluginHost({ grantedPermissions: '*', publicKey: signer.publicKey });
    const { record, durationMs } = await installThroughRegistry(reg, host, new S3Plugin(s3Config));

    assert.equal(record.manifest.name, S3_PLUGIN_NAME);
    assert.equal(host.has(S3_PLUGIN_NAME), true);
    assert.equal(host.state(S3_PLUGIN_NAME), 'enabled');
    assert.ok(durationMs < 60_000, `expected install < 60s, got ${durationMs}ms`);
  });

  it('can install without enabling when enable:false', async () => {
    const signer = ed25519();
    const reg = new LocalPluginRegistry();
    reg.publish(signManifest(s3PluginManifest(), signer.privateKey), signer.publicPem);

    const host = new PluginHost({ grantedPermissions: '*', publicKey: signer.publicKey });
    await installThroughRegistry(reg, host, new S3Plugin(s3Config), { enable: false });
    assert.equal(host.state(S3_PLUGIN_NAME), 'registered');
  });
});

describe('install through registry — enforced signature verification (Req 5.7)', () => {
  it('rejects a bad signature, leaves the installed set unchanged, and does not register', async () => {
    const publisher = ed25519();    // the key the plugin is actually signed with
    const trusted = ed25519();      // the host's trusted key (different)
    const reg = new LocalPluginRegistry();

    // Published validly against the publisher's own key (registry accepts it).
    reg.publish(signManifest(s3PluginManifest(), publisher.privateKey), publisher.publicPem);

    // Host enforces verification against a DIFFERENT trusted key → must reject.
    const host = new PluginHost({ grantedPermissions: '*', publicKey: trusted.publicKey });

    await assert.rejects(
      () => installThroughRegistry(reg, host, new S3Plugin(s3Config)),
      PluginSignatureError,
    );
    // Installed set is unchanged; plugin was never registered.
    assert.equal(host.has(S3_PLUGIN_NAME), false);
    assert.deepEqual(host.list(), []);
    assert.equal(host.state(S3_PLUGIN_NAME), undefined);
  });

  it('refuses to install through a host that does not enforce signatures', async () => {
    const signer = ed25519();
    const reg = new LocalPluginRegistry();
    reg.publish(signManifest(s3PluginManifest(), signer.privateKey), signer.publicPem);

    const host = new PluginHost({ grantedPermissions: '*' }); // no publicKey → no enforcement
    await assert.rejects(
      () => installThroughRegistry(reg, host, new S3Plugin(s3Config)),
      (err: unknown) => err instanceof PluginError && /must be configured with a trusted public key/.test((err as Error).message),
    );
    assert.equal(host.has(S3_PLUGIN_NAME), false);
  });
});

describe('install through registry — missing/malformed manifest (Req 5.8)', () => {
  it('rejects a plugin that is not in the registry with an identifying error', async () => {
    const signer = ed25519();
    const reg = new LocalPluginRegistry();
    const host = new PluginHost({ grantedPermissions: '*', publicKey: signer.publicKey });

    await assert.rejects(
      () => installThroughRegistry(reg, host, new S3Plugin(s3Config)),
      (err: unknown) => err instanceof PluginError && new RegExp(`${S3_PLUGIN_NAME}@`).test((err as Error).message),
    );
    assert.equal(host.has(S3_PLUGIN_NAME), false);
  });

  it('rejects a malformed (but validly signed) manifest with PluginManifestError', async () => {
    const signer = ed25519();
    const reg = new LocalPluginRegistry();
    // A manifest whose capabilities are malformed (non-string), signed validly.
    const bad = { ...s3PluginManifest(), capabilities: [123 as unknown as string] };
    reg.publish(signManifest(bad as PluginManifest, signer.privateKey), signer.publicPem);

    const host = new PluginHost({ grantedPermissions: '*', publicKey: signer.publicKey });
    await assert.rejects(
      () => installThroughRegistry(reg, host, new S3Plugin(s3Config)),
      (err: unknown) => err instanceof PluginManifestError && /capabilities/.test((err as Error).message),
    );
    // Rejected before registration — installed set unchanged.
    assert.equal(host.has(S3_PLUGIN_NAME), false);
  });
});

describe('assertWellFormedManifest', () => {
  it('accepts a well-formed manifest', () => {
    assert.doesNotThrow(() => assertWellFormedManifest(s3PluginManifest()));
  });
  it('rejects a missing manifest', () => {
    assert.throws(() => assertWellFormedManifest(null), PluginManifestError);
    assert.throws(() => assertWellFormedManifest(undefined), PluginManifestError);
  });
  it('rejects a manifest missing name', () => {
    assert.throws(
      () => assertWellFormedManifest({ version: '1.0.0' } as unknown as PluginManifest),
      /"name" is required/,
    );
  });
  it('rejects a manifest missing version', () => {
    assert.throws(
      () => assertWellFormedManifest({ name: 'x' } as unknown as PluginManifest),
      /"version" is required/,
    );
  });
  it('rejects malformed permissions', () => {
    assert.throws(
      () => assertWellFormedManifest({ name: 'x', version: '1.0.0', permissions: ['bogus'] } as unknown as PluginManifest),
      /"permissions" must be an array of known permissions/,
    );
  });
  it('rejects malformed dependencies', () => {
    assert.throws(
      () => assertWellFormedManifest({ name: 'x', version: '1.0.0', dependencies: [] as unknown } as unknown as PluginManifest),
      /"dependencies" must be an object/,
    );
  });
});
