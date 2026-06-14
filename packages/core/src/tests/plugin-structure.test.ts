// tests/plugin-structure.test.ts
// Verifies the per-package official-plugin structure (Req 5.5) and the
// signature-enforcement behavior on install (Req 5.7 / 5.8) for the seven
// official plugin packages shipped under packages/plugin-*:
//
//   - storage:   plugin-redis, plugin-s3, plugin-r2
//   - messaging: plugin-twilio, plugin-sendgrid
//   - payments:  plugin-stripe
//   - identity:  plugin-auth0
//
// For each package this asserts the uniform layout required by Req 5.5 — a
// source module extending the PluginModule SDK, a Plugin Manifest, a real
// Ed25519 signature (manifest.signed.json verifiable against manifest.pub),
// documentation (README.md), and a runnable example application (example/).
//
// It then exercises the enforced signature path against the REAL on-disk signed
// manifests: a signature-enforcing PluginHost accepts a faithfully signed
// manifest (5.7 happy path) and rejects a tampered one with a
// PluginSignatureError while leaving the installed set unchanged (5.7), and a
// missing/malformed manifest is rejected with an identifying PluginManifestError
// (5.8). Offline only — node:crypto/node:fs, no network, no built packages.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import {
  PluginHost, verifyManifest, signManifest,
  PluginSignatureError, PluginManifestError,
  type PluginManifest,
} from '../platform/plugins/host.js';
import { PluginModule } from '../platform/plugins/sdk.js';
import { assertWellFormedManifest } from '../platform/plugins/local-registry.js';

// ── Locate the monorepo `packages/` directory from the compiled test file ────

function findPackagesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, 'packages');
    if (existsSync(join(candidate, 'plugin-redis', 'manifest.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the monorepo packages/ directory from the test location');
}

const PACKAGES_DIR = findPackagesDir();

/** The official plugin packages and their requirement grouping (Req 5.1–5.5). */
const OFFICIAL_PLUGIN_PACKAGES: ReadonlyArray<{ dir: string; category: string }> = [
  { dir: 'plugin-redis', category: 'storage' },
  { dir: 'plugin-s3', category: 'storage' },
  { dir: 'plugin-r2', category: 'storage' },
  { dir: 'plugin-twilio', category: 'messaging' },
  { dir: 'plugin-sendgrid', category: 'messaging' },
  { dir: 'plugin-stripe', category: 'payments' },
  { dir: 'plugin-auth0', category: 'identity' },
  { dir: 'plugin-nats', category: 'messaging' },
  { dir: 'plugin-kafka', category: 'messaging' },
  { dir: 'plugin-rabbitmq', category: 'messaging' },
  { dir: 'plugin-postgres', category: 'database' },
  { dir: 'plugin-mysql', category: 'database' },
  { dir: 'plugin-paypal', category: 'payments' },
  { dir: 'plugin-openai', category: 'ai' },
  { dir: 'plugin-clerk', category: 'identity' },
  { dir: 'plugin-supabase', category: 'database' },
  { dir: 'plugin-firebase', category: 'identity' },
  { dir: 'plugin-mongodb', category: 'database' },
];

function pkgPath(pkgDir: string, ...rest: string[]): string {
  return join(PACKAGES_DIR, pkgDir, ...rest);
}

function readManifest(pkgDir: string, file: string): PluginManifest {
  return JSON.parse(readFileSync(pkgPath(pkgDir, file), 'utf8')) as PluginManifest;
}

/** A minimal in-test plugin whose identity matches a given manifest. */
class FixturePlugin extends PluginModule {
  constructor(readonly name: string, readonly version: string) {
    super();
  }
}

// ── Req 5.5 — uniform per-package structure ──────────────────────────────────

describe('official plugin packages — per-package structure (Req 5.5)', () => {
  for (const { dir, category } of OFFICIAL_PLUGIN_PACKAGES) {
    describe(`${dir} (${category})`, () => {
      it('has a source module that provides a PluginModule (defined or re-exported from the SDK)', () => {
        const indexPath = pkgPath(dir, 'src', 'index.ts');
        assert.ok(existsSync(indexPath), `${dir}/src/index.ts must exist`);
        const src = readFileSync(indexPath, 'utf8');
        // A package either defines its own `class … extends PluginModule`
        // (e.g. the dependency-free Redis client) or repackages a canonical
        // PluginModule subclass from the core SDK and (re-)exports it.
        const providesPlugin =
          /extends\s+PluginModule/.test(src) ||
          /export\s+default\s+\w*Plugin/.test(src) ||
          /export\s*\{[\s\S]*?\w*Plugin/.test(src);
        assert.ok(providesPlugin, `${dir} must define or re-export a PluginModule subclass`);
      });

      it('includes a well-formed Plugin Manifest (manifest.json)', () => {
        const manifestPath = pkgPath(dir, 'manifest.json');
        assert.ok(existsSync(manifestPath), `${dir}/manifest.json must exist`);
        const manifest = readManifest(dir, 'manifest.json');
        assert.doesNotThrow(() => assertWellFormedManifest(manifest));
        assert.equal(typeof manifest.name, 'string');
        assert.ok(manifest.name.trim() !== '');
        assert.equal(typeof manifest.version, 'string');
      });

      it('includes an Ed25519-signed manifest (manifest.signed.json) with checksum + signature', () => {
        const signedPath = pkgPath(dir, 'manifest.signed.json');
        assert.ok(existsSync(signedPath), `${dir}/manifest.signed.json must exist`);
        const signed = readManifest(dir, 'manifest.signed.json');
        assert.equal(typeof signed.checksum, 'string', 'signed manifest must carry a checksum');
        assert.equal(typeof signed.signature, 'string', 'signed manifest must carry an Ed25519 signature');
        // The signed manifest must describe the same plugin as the unsigned one.
        const unsigned = readManifest(dir, 'manifest.json');
        assert.equal(signed.name, unsigned.name);
        assert.equal(signed.version, unsigned.version);
      });

      it('ships documentation (README.md)', () => {
        const readmePath = pkgPath(dir, 'README.md');
        assert.ok(existsSync(readmePath), `${dir}/README.md must exist`);
        assert.ok(readFileSync(readmePath, 'utf8').trim().length > 0, `${dir}/README.md must be non-empty`);
      });

      it('ships a runnable example application (example/)', () => {
        const exampleDir = pkgPath(dir, 'example');
        assert.ok(existsSync(exampleDir) && statSync(exampleDir).isDirectory(), `${dir}/example must be a directory`);
        assert.ok(readdirSync(exampleDir).length > 0, `${dir}/example must contain at least one file`);
      });

      it('declares the streetjs core dependency in package.json', () => {
        const pkg = JSON.parse(readFileSync(pkgPath(dir, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>;
        };
        assert.ok(pkg.dependencies?.['streetjs'], `${dir} must depend on streetjs (the core SDK)`);
      });
    });
  }
});

// ── Req 5.5 / 5.7 — the on-disk signature is real and verifies ───────────────

describe('official plugin packages — Ed25519 signature is verifiable (Req 5.5)', () => {
  for (const { dir } of OFFICIAL_PLUGIN_PACKAGES) {
    it(`${dir}: manifest.signed.json verifies against manifest.pub`, () => {
      const signed = readManifest(dir, 'manifest.signed.json');
      const pubPath = pkgPath(dir, 'manifest.pub');
      assert.ok(existsSync(pubPath), `${dir}/manifest.pub must exist`);
      const publicKey = createPublicKey(readFileSync(pubPath, 'utf8'));
      assert.equal(verifyManifest(signed, publicKey), true, `${dir} signed manifest must verify against its public key`);
    });
  }
});

// ── Req 5.7 — signature enforcement on install ───────────────────────────────

describe('official plugin packages — enforced signature verification on install (Req 5.7)', () => {
  for (const { dir } of OFFICIAL_PLUGIN_PACKAGES) {
    it(`${dir}: a host with the trusted key registers the validly signed plugin`, () => {
      const signed = readManifest(dir, 'manifest.signed.json');
      const publicKey = createPublicKey(readFileSync(pkgPath(dir, 'manifest.pub'), 'utf8'));
      const host = new PluginHost({ grantedPermissions: '*', publicKey });
      assert.equal(host.verifiesSignatures(), true);

      const plugin = new FixturePlugin(signed.name, signed.version);
      assert.doesNotThrow(() => host.register(plugin, signed));
      assert.equal(host.has(signed.name), true);
    });

    it(`${dir}: a tampered manifest is rejected and the installed set is unchanged`, () => {
      const signed = readManifest(dir, 'manifest.signed.json');
      const publicKey = createPublicKey(readFileSync(pkgPath(dir, 'manifest.pub'), 'utf8'));
      const host = new PluginHost({ grantedPermissions: '*', publicKey });

      // Tamper with the signed body WITHOUT re-signing → checksum/signature no longer match.
      const tampered: PluginManifest = {
        ...signed,
        capabilities: [...(signed.capabilities ?? []), 'tampered-capability'],
      };
      assert.equal(verifyManifest(tampered, publicKey), false, 'tampered manifest must fail verification');

      const plugin = new FixturePlugin(tampered.name, tampered.version);
      assert.throws(() => host.register(plugin, tampered), PluginSignatureError);
      // Rejected before recording → installed set unchanged, plugin not registered.
      assert.equal(host.has(tampered.name), false);
      assert.deepEqual(host.list(), []);
      assert.equal(host.state(tampered.name), undefined);
    });

    it(`${dir}: a manifest signed by an untrusted key is rejected`, () => {
      // Re-sign with a DIFFERENT key, then enforce against the package's trusted key.
      const rogue = generateKeyPairSync('ed25519');
      const rogueSigned = signManifest(readManifest(dir, 'manifest.json'), rogue.privateKey);
      const trustedKey = createPublicKey(readFileSync(pkgPath(dir, 'manifest.pub'), 'utf8'));

      const host = new PluginHost({ grantedPermissions: '*', publicKey: trustedKey });
      const plugin = new FixturePlugin(rogueSigned.name, rogueSigned.version);
      assert.throws(() => host.register(plugin, rogueSigned), PluginSignatureError);
      assert.equal(host.has(rogueSigned.name), false);
    });
  }
});

// ── Req 5.8 — missing / malformed manifest rejection ─────────────────────────

describe('official plugin packages — missing/malformed manifest rejection (Req 5.8)', () => {
  it('rejects a missing manifest with an identifying PluginManifestError', () => {
    assert.throws(() => assertWellFormedManifest(null), PluginManifestError);
    assert.throws(() => assertWellFormedManifest(undefined), PluginManifestError);
    assert.throws(() => assertWellFormedManifest(null), /missing/);
  });

  for (const { dir } of OFFICIAL_PLUGIN_PACKAGES) {
    it(`${dir}: a manifest missing its version is rejected with an identifying error`, () => {
      const manifest = readManifest(dir, 'manifest.json');
      const malformed = { name: manifest.name } as unknown as PluginManifest; // drop version
      assert.throws(
        () => assertWellFormedManifest(malformed),
        (err: unknown) => err instanceof PluginManifestError && /"version" is required/.test((err as Error).message),
      );
    });

    it(`${dir}: a manifest with malformed permissions is rejected with an identifying error`, () => {
      const manifest = readManifest(dir, 'manifest.json');
      const malformed = { ...manifest, permissions: ['bogus-permission'] } as unknown as PluginManifest;
      assert.throws(
        () => assertWellFormedManifest(malformed),
        (err: unknown) => err instanceof PluginManifestError && /"permissions" must be an array of known permissions/.test((err as Error).message),
      );
    });
  }
});
