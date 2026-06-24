// packages/core/tests/plugin-install-gate-examples.test.ts
//
// Feature: plugin-installer-hardening, Property 2 (PS-2) — fail-closed install
//   gate: deterministic EXAMPLE tests (task 5.3).
//
// FIX-CHECKING EXAMPLE TESTS — run against the FIXED `registry.ts`
// (secure-by-default `trustedKey`, `assertHttps`, `installerManifestSchema`
// validation in `_fetchManifest`, reordered fail-closed `install()` verifying
// over the RECOMPUTED canonical checksum via `verifyManifest`, plus the PS-1
// containment guard in `_extractTarball`).
//
// Where the Property 2 PBT (plugin-install-gate.test.ts) covers the gate across
// random dimensions, these plain `it(...)` cases pin the four concrete,
// security-critical scenarios called out by the design's "Unit Tests" section:
//
//   1. Non-https transport rejection (registryUrl / tarballUrl) — abort before
//      the corresponding network stage, no filesystem side effects.   Req 2.8, 2.9
//   2. Missing / invalid signature without allowUnsigned — abort before any
//      download.                                                       Req 2.6, 2.7, 2.9
//   3. Swapped-body forgery — a VALID signature over the original canonical body
//      but with `manifest.checksum` swapped to a malicious tarball's hash is
//      rejected by `verifyManifest` (strength S2: the checksum is RECOMPUTED at
//      verify time, so the body/checksum mismatch is detected).        Req 2.6
//   4. `allowUnsigned: true` escape hatch — an unsigned-but-schema-valid https
//      manifest installs and the warning is emitted, yet https pinning and PS-1
//      path containment are STILL enforced.                            Req 2.5, 3.6
//
// Validates: Requirements 2.5, 2.6, 2.7, 2.8, 2.9, 3.6

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

import {
  PluginInstaller,
  type PluginInstallerOptions,
} from '../src/platform/plugins/registry.js';
import {
  signManifest,
  manifestChecksum,
  type PluginManifest,
} from '../src/platform/plugins/host.js';
import {
  generateKeypair,
  exportPublicKeyPem,
  RegistryStub,
  withTempDir,
  type Keypair,
  type InstallerManifest,
} from './helpers/plugin-registry-stub.js';
import { makeTar, fileEntry, traversalEntry } from './helpers/plugin-archive.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

const NAME = 'demo-plugin';
const VERSION = '1.2.3';

/** A schema-valid signable manifest body (no checksum/signature/tarballUrl). */
function baseBody(): PluginManifest {
  return {
    name: NAME,
    version: VERSION,
    capabilities: ['demo'],
    permissions: [],
    dependencies: {},
  };
}

/** sha256 hex of a buffer (matches the installer's integrity hash). */
function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Construct an installer with the given options while capturing any
 * `console.warn` the constructor emits (the allowUnsigned escape-hatch notice).
 * Returns the installer plus the captured warning lines.
 */
function makeInstaller(opts: PluginInstallerOptions): {
  installer: PluginInstaller;
  warnings: string[];
} {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(' '));
  };
  try {
    const installer = new PluginInstaller(opts);
    return { installer, warnings };
  } finally {
    console.warn = originalWarn;
  }
}

// ── 1. Non-https transport rejection (Req 2.8, 2.9) ───────────────────────────

describe('PS-2 examples — non-https transport rejection (Req 2.8, 2.9)', () => {
  it('rejects an http: registryUrl BEFORE fetching the manifest (no fetch/download/extract, no fs artifacts)', async () => {
    const { publicKey, privateKey }: Keypair = generateKeypair();
    const { dir: pluginsDir, cleanup } = await withTempDir();
    try {
      const signed = signManifest(baseBody(), privateKey);
      const manifest: InstallerManifest = {
        ...signed,
        tarballUrl: 'https://cdn.streetjs.dev/demo.tgz',
      };
      const { installer } = makeInstaller({
        pluginsDir,
        registryUrl: 'http://registry.streetjs.dev', // non-https registry transport
        publicKey: exportPublicKeyPem(publicKey),
      });
      const stub = new RegistryStub({
        registryUrl: 'http://registry.streetjs.dev',
        tarballUrl: manifest.tarballUrl,
        manifest,
        tarball: makeTar([fileEntry('lib/index.js', 'ok')]),
      });
      stub.attachTo(installer);

      await assert.rejects(
        () => installer.install(NAME, VERSION),
        /non-https/i,
        'http: registry transport must be rejected',
      );

      // Aborted at gate (a): the manifest fetch never even happened.
      assert.equal(stub.fetchTextCount, 0, 'manifest fetch must NOT occur for non-https registryUrl');
      assert.equal(stub.downloadReached, false, 'no tarball download on abort');
      assert.equal(stub.extractReached, false, 'no extraction on abort');
      assert.deepEqual(await fs.readdir(pluginsDir), [], 'no filesystem side effects on abort');
    } finally {
      await cleanup();
    }
  });

  it('rejects a file: tarballUrl AFTER the manifest fetch but BEFORE any download (no download/extract)', async () => {
    const { publicKey, privateKey }: Keypair = generateKeypair();
    const { dir: pluginsDir, cleanup } = await withTempDir();
    try {
      // Valid signature + schema, but the advertised tarball transport is file:.
      const signed = signManifest(baseBody(), privateKey);
      const manifest: InstallerManifest = {
        ...signed,
        tarballUrl: 'file:///etc/passwd', // non-https tarball transport
      };
      const { installer } = makeInstaller({
        pluginsDir,
        registryUrl: 'https://registry.streetjs.dev',
        publicKey: exportPublicKeyPem(publicKey),
      });
      const stub = new RegistryStub({
        registryUrl: 'https://registry.streetjs.dev',
        tarballUrl: manifest.tarballUrl,
        manifest,
        tarball: makeTar([fileEntry('lib/index.js', 'ok')]),
      });
      stub.attachTo(installer);

      await assert.rejects(
        () => installer.install(NAME, VERSION),
        /non-https/i,
        'file: tarball transport must be rejected',
      );

      // Gate (a) passed (https registry) → manifest fetched once; gate (d) then
      // rejects the non-https tarball BEFORE any download (Req 2.8, 2.9).
      assert.equal(stub.fetchTextCount, 1, 'manifest fetched once (https registry passed)');
      assert.equal(stub.downloadReached, false, 'download must NOT occur for non-https tarballUrl');
      assert.equal(stub.extractReached, false, 'no extraction on abort');
      assert.deepEqual(await fs.readdir(pluginsDir), [], 'no filesystem side effects on abort');
    } finally {
      await cleanup();
    }
  });
});

// ── 2. Missing / invalid signature without allowUnsigned (Req 2.6, 2.7, 2.9) ──

describe('PS-2 examples — missing / invalid signature without allowUnsigned (Req 2.6, 2.7, 2.9)', () => {
  it('rejects a manifest with NO signature field before any download (Req 2.7)', async () => {
    const { publicKey, privateKey }: Keypair = generateKeypair();
    void privateKey;
    const { dir: pluginsDir, cleanup } = await withTempDir();
    try {
      const body = baseBody();
      // Real checksum, but the signature field is absent.
      const manifest: InstallerManifest = {
        ...body,
        checksum: manifestChecksum(body),
        tarballUrl: 'https://cdn.streetjs.dev/demo.tgz',
      };
      const { installer } = makeInstaller({
        pluginsDir,
        registryUrl: 'https://registry.streetjs.dev',
        publicKey: exportPublicKeyPem(publicKey),
      });
      const stub = new RegistryStub({
        registryUrl: 'https://registry.streetjs.dev',
        tarballUrl: manifest.tarballUrl,
        manifest,
        tarball: makeTar([fileEntry('lib/index.js', 'ok')]),
      });
      stub.attachTo(installer);

      await assert.rejects(
        () => installer.install(NAME, VERSION),
        /missing a signature/i,
        'a signature-absent manifest must be rejected',
      );

      // Schema-validated (fetch occurred) but rejected for missing signature
      // BEFORE any download (Req 2.7, 2.9).
      assert.equal(stub.fetchTextCount, 1, 'manifest fetched + schema-validated');
      assert.equal(stub.downloadReached, false, 'no download for unsigned manifest');
      assert.equal(stub.extractReached, false, 'no extraction for unsigned manifest');
      assert.deepEqual(await fs.readdir(pluginsDir), [], 'no filesystem side effects on abort');
    } finally {
      await cleanup();
    }
  });

  it('rejects a manifest signed by a DIFFERENT key (signature does not verify) before any download (Req 2.6)', async () => {
    const trusted: Keypair = generateKeypair();
    const attacker: Keypair = generateKeypair();
    const { dir: pluginsDir, cleanup } = await withTempDir();
    try {
      // Correctly signed — but by the attacker's key, not the trusted key.
      const signed = signManifest(baseBody(), attacker.privateKey);
      const manifest: InstallerManifest = {
        ...signed,
        tarballUrl: 'https://cdn.streetjs.dev/demo.tgz',
      };
      const { installer } = makeInstaller({
        pluginsDir,
        registryUrl: 'https://registry.streetjs.dev',
        publicKey: exportPublicKeyPem(trusted.publicKey), // trusts a different key
      });
      const stub = new RegistryStub({
        registryUrl: 'https://registry.streetjs.dev',
        tarballUrl: manifest.tarballUrl,
        manifest,
        tarball: makeTar([fileEntry('lib/index.js', 'ok')]),
      });
      stub.attachTo(installer);

      await assert.rejects(
        () => installer.install(NAME, VERSION),
        /invalid marketplace signature/i,
        'a signature that does not verify against the trusted key must be rejected',
      );

      // Signature verification (gate e) runs BEFORE download → no download/extract.
      assert.equal(stub.downloadReached, false, 'no download when signature fails to verify');
      assert.equal(stub.extractReached, false, 'no extraction when signature fails to verify');
      assert.deepEqual(await fs.readdir(pluginsDir), [], 'no filesystem side effects on abort');
    } finally {
      await cleanup();
    }
  });
});

// ── 3. Swapped-body forgery → verifyManifest S2 rejection (Req 2.6) ───────────

describe('PS-2 examples — swapped-body forgery rejected by recomputed checksum (S2, Req 2.6)', () => {
  it('rejects a manifest whose checksum was swapped to a malicious tarball hash, even with a valid signature over the original body', async () => {
    const trusted: Keypair = generateKeypair();
    const { dir: pluginsDir, cleanup } = await withTempDir();
    try {
      const body = baseBody();

      // (1) Legitimately sign the canonical body with the TRUSTED key. This sets
      //     `checksum = manifestChecksum(body)` and a valid Ed25519 `signature`
      //     over THAT canonical checksum.
      const signed = signManifest(body, trusted.privateKey);
      const canonicalChecksum = signed.checksum!;

      // (2) The attacker crafts a malicious tarball and computes its hash.
      const maliciousTarball = makeTar([fileEntry('payload.sh', '#!/bin/sh\nrm -rf /\n')]);
      const maliciousHash = sha256(maliciousTarball);
      assert.notEqual(
        maliciousHash,
        canonicalChecksum,
        'sanity: the malicious tarball hash differs from the real canonical checksum',
      );

      // (3) Swapped-body forgery: keep the VALID signature (still over the
      //     original canonical checksum) but swap `manifest.checksum` to the
      //     malicious tarball's hash so the downstream integrity gate WOULD pass.
      //     `tarballUrl`/`checksum`/`signature` are OUTSIDE the canonical body,
      //     so `manifestChecksum(forged)` still recomputes to `canonicalChecksum`.
      const forged: InstallerManifest = {
        ...signed,
        checksum: maliciousHash,
        tarballUrl: 'https://cdn.streetjs.dev/demo.tgz',
      };

      const { installer } = makeInstaller({
        pluginsDir,
        registryUrl: 'https://registry.streetjs.dev',
        publicKey: exportPublicKeyPem(trusted.publicKey),
      });
      const stub = new RegistryStub({
        registryUrl: 'https://registry.streetjs.dev',
        tarballUrl: forged.tarballUrl,
        manifest: forged,
        tarball: maliciousTarball,
      });
      stub.attachTo(installer);

      // verifyManifest recomputes `expected = manifestChecksum(forged)` and
      // rejects because `forged.checksum (maliciousHash) !== expected
      // (canonicalChecksum)` — strength S2 — BEFORE any download/extract.
      await assert.rejects(
        () => installer.install(NAME, VERSION),
        /invalid marketplace signature/i,
        'the swapped-body forgery must be rejected by verifyManifest (S2)',
      );

      assert.equal(stub.downloadReached, false, 'forgery aborts before the malicious tarball is downloaded');
      assert.equal(stub.extractReached, false, 'forgery aborts before extraction');
      assert.deepEqual(await fs.readdir(pluginsDir), [], 'no filesystem side effects on forgery rejection');
    } finally {
      await cleanup();
    }
  });
});

// ── 4. allowUnsigned escape hatch — still enforces https + PS-1 (Req 2.5, 3.6) ─

describe('PS-2 examples — allowUnsigned escape hatch (Req 2.5, 3.6)', () => {
  /**
   * Build an unsigned-but-schema-valid installer manifest whose checksum matches
   * `tarball`. Note: `_fetchManifest` requires a `signature` FIELD even in
   * allowUnsigned mode (only signature *verification* is waived), so a present
   * (non-verifying) signature placeholder is attached.
   */
  function unsignedManifestFor(tarball: Buffer, tarballUrl: string): InstallerManifest {
    const body = baseBody();
    return {
      ...body,
      checksum: sha256(tarball), // integrity-only target in allowUnsigned mode
      signature: 'AA==', // present (required) but never verified
      tarballUrl,
    };
  }

  it('installs an unsigned schema-valid https manifest, emits the escape-hatch warning, and extracts', async () => {
    const { dir: pluginsDir, cleanup } = await withTempDir();
    try {
      const tarball = makeTar([fileEntry('lib/index.js', 'console.log(1)')]);
      const tarballUrl = 'https://cdn.streetjs.dev/demo.tgz';
      const manifest = unsignedManifestFor(tarball, tarballUrl);

      const { installer, warnings } = makeInstaller({
        pluginsDir,
        registryUrl: 'https://registry.streetjs.dev',
        allowUnsigned: true,
      });

      // The escape hatch is logged at construction time (Req 2.5 / 3.6).
      assert.ok(
        warnings.some((w) => /allowUnsigned=true/i.test(w) && /verification is DISABLED/i.test(w)),
        'the allowUnsigned escape-hatch warning must be emitted',
      );

      const stub = new RegistryStub({
        registryUrl: 'https://registry.streetjs.dev',
        tarballUrl,
        manifest,
        tarball,
      });
      stub.attachTo(installer);

      await assert.doesNotReject(
        () => installer.install(NAME, VERSION),
        'an unsigned, schema-valid, https, checksum-matching manifest installs under allowUnsigned',
      );

      assert.equal(stub.downloadReached, true, 'tarball downloaded under allowUnsigned');
      assert.equal(stub.extractReached, true, 'tarball extracted under allowUnsigned');
      const destDir = path.join(pluginsDir, `${NAME}@${VERSION}`);
      assert.equal(await pathExists(path.join(destDir, 'lib', 'index.js')), true, 'plugin file extracted in-containment');
    } finally {
      await cleanup();
    }
  });

  it('STILL rejects a path-traversal entry under allowUnsigned (PS-1 containment is not waived)', async () => {
    const { dir: pluginsDir, cleanup } = await withTempDir();
    try {
      // A malicious tarball carrying a zip-slip entry; its checksum matches the
      // manifest so the integrity gate passes — only PS-1 should stop it.
      const evilTarball = makeTar([traversalEntry('../../escape.txt', 'pwned')]);
      const tarballUrl = 'https://cdn.streetjs.dev/demo.tgz';
      const manifest = unsignedManifestFor(evilTarball, tarballUrl);

      const { installer } = makeInstaller({
        pluginsDir,
        registryUrl: 'https://registry.streetjs.dev',
        allowUnsigned: true,
      });
      const stub = new RegistryStub({
        registryUrl: 'https://registry.streetjs.dev',
        tarballUrl,
        manifest,
        tarball: evilTarball,
      });
      stub.attachTo(installer);

      await assert.rejects(
        () => installer.install(NAME, VERSION),
        /path-traversal/i,
        'PS-1 containment must reject a traversal entry even under allowUnsigned',
      );

      // The integrity gate passed and the tarball downloaded, but extraction was
      // aborted by the containment pre-pass with no out-of-containment artifact.
      assert.equal(stub.downloadReached, true, 'download occurs (checksum matched) before extraction');
      const escaped = path.resolve(pluginsDir, '..', '..', 'escape.txt');
      assert.equal(await pathExists(escaped), false, 'no traversal artifact written outside the extraction root');
    } finally {
      await cleanup();
    }
  });

  it('STILL rejects non-https transport under allowUnsigned (https pinning is not waived)', async () => {
    const { dir: pluginsDir, cleanup } = await withTempDir();
    try {
      const tarball = makeTar([fileEntry('lib/index.js', 'ok')]);
      const manifest = unsignedManifestFor(tarball, 'https://cdn.streetjs.dev/demo.tgz');

      const { installer } = makeInstaller({
        pluginsDir,
        registryUrl: 'http://registry.streetjs.dev', // non-https, even under allowUnsigned
        allowUnsigned: true,
      });
      const stub = new RegistryStub({
        registryUrl: 'http://registry.streetjs.dev',
        tarballUrl: manifest.tarballUrl,
        manifest,
        tarball,
      });
      stub.attachTo(installer);

      await assert.rejects(
        () => installer.install(NAME, VERSION),
        /non-https/i,
        'https pinning must still reject non-https transport under allowUnsigned',
      );

      assert.equal(stub.fetchTextCount, 0, 'non-https registry rejected before any fetch');
      assert.equal(stub.downloadReached, false, 'no download under allowUnsigned + non-https');
      assert.deepEqual(await fs.readdir(pluginsDir), [], 'no filesystem side effects on abort');
    } finally {
      await cleanup();
    }
  });
});
