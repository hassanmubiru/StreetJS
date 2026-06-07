// tests/plugin-s3.test.ts
// Verifies the official S3 reference plugin end-to-end on the PluginHost:
// config-schema validation, signed-manifest installation + signature
// verification, lifecycle hooks, permission gating, sandbox middleware
// injection, and deterministic AWS SigV4 request signing — all offline.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  PluginHost, signManifest,
  PluginPermissionError, PluginSignatureError, PluginError,
} from '../platform/plugins/host.js';
import {
  S3Plugin, s3PluginManifest, validateS3Config, S3_PLUGIN_NAME,
} from '../platform/plugins/official/s3.js';
import type { StreetContext } from '../core/context.js';

// Verify the symbols are also reachable from the package root export path.
import { S3Plugin as S3PluginDirect } from '../platform/plugins/official/s3.js';

const goodConfig = {
  bucket: 'my-bucket', region: 'us-east-1',
  accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secretkey/example',
};

describe('S3 plugin — config schema', () => {
  it('accepts a valid config and rejects missing/empty fields', () => {
    assert.equal(validateS3Config(goodConfig).bucket, 'my-bucket');
    assert.throws(() => validateS3Config({ ...goodConfig, bucket: '' }), /bucket.*required/);
    assert.throws(() => validateS3Config({ region: 'us-east-1' }), /bucket.*required/);
    assert.throws(() => validateS3Config(null), /must be an object/);
    assert.throws(() => validateS3Config({ ...goodConfig, prefix: 123 }), /prefix.*must be a string/);
  });
  it('is the same class via both export paths', () => {
    assert.equal(S3Plugin, S3PluginDirect);
  });
});

describe('S3 plugin — installation through PluginHost (signed manifest)', () => {
  it('registers, verifies signature, and enables with required permissions', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const host = new PluginHost({ grantedPermissions: ['net', 'secrets', 'middleware'], publicKey });
    const signed = signManifest(s3PluginManifest(), privateKey);

    host.register(new S3Plugin(goodConfig), signed);
    assert.equal(host.has(S3_PLUGIN_NAME), true);
    assert.deepEqual(host.findByCapability('object-storage'), [S3_PLUGIN_NAME]);

    await host.enable(S3_PLUGIN_NAME);
    assert.equal(host.state(S3_PLUGIN_NAME), 'enabled');
    // The plugin contributed exactly one middleware (the injector).
    assert.equal(host.middlewaresOf(S3_PLUGIN_NAME).length, 1);
  });

  it('rejects a tampered/unsigned manifest when the host enforces signatures', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const host = new PluginHost({ grantedPermissions: '*', publicKey });
    const signed = signManifest(s3PluginManifest(), privateKey);
    // Tamper: add a capability after signing.
    const tampered = { ...signed, capabilities: [...(signed.capabilities ?? []), 'backdoor'] };
    assert.throws(() => host.register(new S3Plugin(goodConfig), tampered), PluginSignatureError);
  });
});

describe('S3 plugin — permissions', () => {
  it('cannot enable without the declared permissions granted', async () => {
    const host = new PluginHost({ grantedPermissions: ['net'] }); // missing secrets + middleware
    host.register(new S3Plugin(goodConfig), s3PluginManifest());
    await assert.rejects(() => host.enable(S3_PLUGIN_NAME), PluginPermissionError);
  });
});

describe('S3 plugin — lifecycle & sandbox injection', () => {
  it('injects the S3 adapter into ctx.state via middleware, and unloads cleanly', async () => {
    const host = new PluginHost({ grantedPermissions: '*' });
    const plugin = new S3Plugin({ ...goodConfig, stateKey: 'objectStore' });
    host.register(plugin, s3PluginManifest());
    await host.enable(S3_PLUGIN_NAME);

    // Run the contributed middleware against a minimal ctx and confirm injection.
    const mw = host.middlewaresOf(S3_PLUGIN_NAME)[0]!;
    const ctx = { state: {} as Record<string, unknown> } as unknown as StreetContext;
    await mw(ctx, async () => undefined);
    assert.ok((ctx.state as Record<string, unknown>)['objectStore'], 'adapter injected under stateKey');
    assert.equal((ctx.state as Record<string, unknown>)['objectStore'], plugin.storage);

    await host.disable(S3_PLUGIN_NAME);
    assert.equal(host.state(S3_PLUGIN_NAME), 'disabled');
    assert.throws(() => plugin.storage, PluginError); // adapter released on unload
  });

  it('fails to enable with invalid config (onInstall validation)', async () => {
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(new S3Plugin({ region: 'us-east-1' }), s3PluginManifest()); // missing bucket/keys
    await assert.rejects(() => host.enable(S3_PLUGIN_NAME), /bucket.*required/);
  });
});

describe('S3 plugin — deterministic AWS SigV4 signing (offline)', () => {
  const plugin = new S3Plugin(goodConfig);
  const fixedDate = new Date('2025-01-01T00:00:00.000Z');
  const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('produces a well-formed, deterministic SigV4 Authorization header', () => {
    const h1 = plugin.signedObjectHeaders('GET', 'reports/2025.csv', emptyHash, fixedDate);
    const h2 = plugin.signedObjectHeaders('GET', 'reports/2025.csv', emptyHash, fixedDate);
    assert.match(h1['authorization']!, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20250101\/us-east-1\/s3\/aws4_request/);
    assert.match(h1['authorization']!, /Signature=[0-9a-f]{64}$/);
    assert.equal(h1['x-amz-date'], '20250101T000000Z');
    assert.equal(h1['x-amz-content-sha256'], emptyHash);
    assert.equal(h1['authorization'], h2['authorization'], 'same inputs → identical signature');
  });

  it('changes the signature when the object key changes', () => {
    const a = plugin.signedObjectHeaders('GET', 'a.txt', emptyHash, fixedDate)['authorization'];
    const b = plugin.signedObjectHeaders('GET', 'b.txt', emptyHash, fixedDate)['authorization'];
    assert.notEqual(a, b);
  });

  it('honours the configured prefix in the canonical path', () => {
    const p = new S3Plugin({ ...goodConfig, prefix: 'tenants/acme' });
    const sig = p.signedObjectHeaders('PUT', 'file.bin', emptyHash, fixedDate)['authorization'];
    // Different path (prefixed) ⇒ different signature than the unprefixed plugin.
    const base = plugin.signedObjectHeaders('PUT', 'file.bin', emptyHash, fixedDate)['authorization'];
    assert.notEqual(sig, base);
  });
});
