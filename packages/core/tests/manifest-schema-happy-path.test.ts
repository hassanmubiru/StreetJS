import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import {
  PluginHost,
  PluginError,
  PluginManifestError,
  signManifest,
  type PluginManifest,
} from '../src/platform/plugins/host.js';
import { PluginModule, type SandboxedApp } from '../src/platform/plugins/sdk.js';

// Feature: security-hardening — example test for the manifest schema happy path.
//
// A valid (and, where applicable, signed) manifest passes the schema gate and
// proceeds to the existing name/version-identity + signature-verification steps.
// These example tests demonstrate that the schema gate (the FIRST step of
// `register`) admits well-formed manifests and that control then flows on to the
// subsequent steps.
//
// Validates: Requirements 5.3

// ---- helpers ----------------------------------------------------------------

/**
 * Minimal concrete plugin. `PluginModule` is abstract (only `name`/`version` are
 * required), so a tiny subclass is the lightest faithful test double.
 */
class TestPlugin extends PluginModule {
  constructor(readonly name: string, readonly version: string) {
    super();
  }
  // No lifecycle hooks needed for registration-level assertions.
  async onLoad(_app: SandboxedApp): Promise<void> {
    /* no-op */
  }
}

describe('Manifest schema happy path (Req 5.3)', () => {
  it('a valid unsigned manifest passes the schema gate and registers (proceeds to name/version step)', () => {
    // Host without a publicKey => signature verification is skipped; the manifest
    // must still clear the schema gate and the name/version-identity check.
    const host = new PluginHost();
    const plugin = new TestPlugin('analytics', '1.2.3');
    const manifest: PluginManifest = {
      name: 'analytics',
      version: '1.2.3',
      capabilities: ['metrics'],
      permissions: ['events', 'net'],
      dependencies: { logger: '^1.0.0' },
    };

    assert.doesNotThrow(() => host.register(plugin, manifest));

    // The gate passed AND control proceeded through the name/version step to
    // complete registration.
    assert.equal(host.has('analytics'), true);
    assert.equal(host.state('analytics'), 'registered');
    assert.deepEqual(host.manifestOf('analytics'), manifest);
  });

  it('a valid SIGNED manifest passes the schema gate AND the signature-verification step', () => {
    // Generate an Ed25519 keypair; sign the manifest; configure the host with the
    // matching public key so `register` runs the signature gate after the schema
    // gate. A successful register proves both gates passed in sequence.
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');

    const base: PluginManifest = {
      name: 'billing',
      version: '2.0.0',
      capabilities: ['payments'],
      permissions: ['db', 'secrets'],
    };
    const signed = signManifest(base, privateKey);

    const host = new PluginHost({ publicKey });
    const plugin = new TestPlugin('billing', '2.0.0');

    assert.equal(host.verifiesSignatures(), true);
    assert.doesNotThrow(() => host.register(plugin, signed));

    assert.equal(host.has('billing'), true);
    assert.equal(host.state('billing'), 'registered');
    assert.equal(host.manifestOf('billing')?.signature, signed.signature);
  });

  it('a schema-valid manifest with a name/version mismatch clears the gate then fails the name/version step', () => {
    // The manifest is well-formed (passes the schema gate), but its name does not
    // match the plugin. The failure must be the name/version PluginError — NOT a
    // PluginManifestError — proving the schema gate passed and control proceeded
    // to the next step.
    const host = new PluginHost();
    const plugin = new TestPlugin('cache', '1.0.0');
    const manifest: PluginManifest = {
      name: 'cache-typo', // schema-valid, but does not match the plugin name
      version: '1.0.0',
    };

    assert.throws(
      () => host.register(plugin, manifest),
      (err: unknown) => {
        assert.ok(err instanceof PluginError, 'expected a PluginError for the name/version mismatch');
        assert.ok(
          !(err instanceof PluginManifestError),
          'must NOT be a PluginManifestError: the schema gate should have passed',
        );
        return true;
      },
    );

    // Nothing was registered.
    assert.equal(host.has('cache'), false);
    assert.equal(host.list().length, 0);
  });
});
