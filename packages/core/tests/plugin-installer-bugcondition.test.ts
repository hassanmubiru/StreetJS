// packages/core/tests/plugin-installer-bugcondition.test.ts
//
// Feature: plugin-installer-hardening, Property 1: Bug Condition
//   PS-1 (zip-slip in `_extractTarball`) + PS-2 (default-open install gate).
//
// EXPLORATION TESTS — written BEFORE any fix, against the UNFIXED
// `registry.ts`. Per the design "Exploratory Bug Condition Checking" section and
// task 2, these assertions CHARACTERIZE the buggy behavior and therefore PASS on
// the current unfixed code (confirming PS-1 and PS-2 exist with concrete
// counterexamples). They are EXPECTED TO FLIP — i.e. these exact assertions will
// FAIL — once the fix lands (tasks 4.4 / 5.4 update them to assert rejection).
// DO NOT fix the code or the tests here.
//
// Documented counterexamples (proof the bugs exist on unfixed code):
//   • PS-1 / Bug 1.1 — a tar entry named `../../evil.txt` is written to
//     `path.resolve(destDir, '../../evil.txt')`, OUTSIDE `path.resolve(destDir)`
//     (arbitrary file write → RCE/persistence).
//   • PS-1 / Bug 1.2 — an absolute-path entry (`//abs/evil.txt`) is NOT rejected:
//     the single-leading-slash strip silently re-contains and writes it; there is
//     no absolute-path guard.
//   • PS-1 / Bug 1.3 — symlink (`'2'`) and hardlink (`'1'`) type-flags are NOT
//     rejected: the extractor silently ignores them (no throw), leaving
//     link-based traversal unguarded.
//   • PS-2 / Bug 1.5-1.6 — `new PluginInstaller({ pluginsDir })` with no
//     `publicKey` installs a self-consistent malicious manifest+tarball
//     (tarball SHA-256 == manifest.checksum) and proceeds to download AND extract
//     with NO signature verification (default-open + self-referential checksum).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';

import { PluginInstaller } from '../src/platform/plugins/registry.js';
import {
  makeTar,
  fileEntry,
  traversalEntry,
  symlinkEntry,
  hardlinkEntry,
} from './helpers/plugin-archive.js';
import {
  RegistryStub,
  withTempDir,
  pathExistsOutside,
} from './helpers/plugin-registry-stub.js';

/** Minimal view onto the installer's private surface exercised by these tests. */
interface InstallerInternals {
  _extractTarball(buffer: Buffer, destDir: string): Promise<void>;
}

function internalsOf(installer: PluginInstaller): InstallerInternals {
  return installer as unknown as InstallerInternals;
}

/** A PluginInstaller wired to a temp pluginsDir (the constructor needs one). */
function makeInstaller(pluginsDir: string): PluginInstaller {
  return new PluginInstaller({ pluginsDir });
}

describe('PS-1 / PS-2 bug condition exploration (UNFIXED code — assertions characterize the bug)', () => {
  // ── PS-1 / Bug 1.1 — `..` traversal escapes destDir ───────────────────────
  it('PS-1 Bug 1.1: a `../../evil.txt` entry is written OUTSIDE path.resolve(destDir)', async () => {
    const { dir: root, cleanup } = await withTempDir();
    try {
      const pluginsDir = path.join(root, 'pluginsDir');
      const destDir = path.join(pluginsDir, 'evil@1.0.0');
      await fs.mkdir(destDir, { recursive: true });

      // Counterexample archive: one entry `../../evil.txt`.
      const tar = makeTar([traversalEntry('../../evil.txt', 'pwned')]);

      const installer = makeInstaller(pluginsDir);
      await internalsOf(installer)._extractTarball(tar, destDir);

      // path.join(destDir, '../../evil.txt') === <root>/evil.txt — escapes destDir.
      const escaped = path.resolve(destDir, '../../evil.txt');
      assert.equal(
        await pathExistsOutside(destDir, escaped),
        true,
        `EXPECTED (unfixed): traversal artifact written outside destDir at ${escaped}`,
      );
      assert.equal(
        await fs.readFile(escaped, 'utf8'),
        'pwned',
        'EXPECTED (unfixed): attacker-controlled bytes landed outside the extraction root',
      );
    } finally {
      await cleanup();
    }
  });

  // ── PS-1 / Bug 1.2 — absolute path is silently re-contained, never rejected ─
  it('PS-1 Bug 1.2: an absolute-path entry is NOT rejected (silently accepted)', async () => {
    const { dir: root, cleanup } = await withTempDir();
    try {
      const pluginsDir = path.join(root, 'pluginsDir');
      const destDir = path.join(pluginsDir, 'abs@1.0.0');
      await fs.mkdir(destDir, { recursive: true });

      // `//abs/evil.txt` survives the single leading-slash strip as `/abs/evil.txt`,
      // which path.join re-contains. The unfixed extractor neither rejects the
      // absolute path nor throws — it silently writes it.
      const tar = makeTar([fileEntry('//abs/evil.txt', 'pwned-abs')]);

      const installer = makeInstaller(pluginsDir);
      await assert.doesNotReject(
        () => internalsOf(installer)._extractTarball(tar, destDir),
        'EXPECTED (unfixed): absolute-path entry is silently accepted, not rejected',
      );

      // Counterexample: the absolute entry was silently re-contained and written.
      const recontained = path.join(destDir, 'abs', 'evil.txt');
      assert.equal(
        existsSync(recontained),
        true,
        `EXPECTED (unfixed): absolute entry silently written to ${recontained} with no rejection`,
      );
    } finally {
      await cleanup();
    }
  });

  // ── PS-1 / Bug 1.3 — link type-flags ('1'/'2') silently ignored ────────────
  it('PS-1 Bug 1.3: symlink (\'2\') and hardlink (\'1\') type-flags are NOT rejected', async () => {
    const { dir: root, cleanup } = await withTempDir();
    try {
      const pluginsDir = path.join(root, 'pluginsDir');
      const destDir = path.join(pluginsDir, 'links@1.0.0');
      await fs.mkdir(destDir, { recursive: true });

      const tar = makeTar([
        symlinkEntry('link', '/etc/passwd'),
        hardlinkEntry('hard', 'target'),
      ]);

      const installer = makeInstaller(pluginsDir);
      // The unfixed extractor only handles '0'/'\0' and '5'; '1'/'2' fall through
      // with neither a write nor a rejection — link-based traversal is unguarded.
      await assert.doesNotReject(
        () => internalsOf(installer)._extractTarball(tar, destDir),
        'EXPECTED (unfixed): link type-flags are silently ignored, not rejected',
      );

      // Counterexample: the link entries were silently dropped (no throw, no file).
      assert.equal(existsSync(path.join(destDir, 'link')), false);
      assert.equal(existsSync(path.join(destDir, 'hard')), false);
    } finally {
      await cleanup();
    }
  });

  // ── PS-2 / Bug 1.5-1.6 — default-open install with self-referential checksum ─
  it('PS-2 Bug 1.5-1.6: install with no publicKey downloads AND extracts a self-consistent malicious plugin', async () => {
    const { dir: pluginsDir, cleanup } = await withTempDir();
    try {
      // A perfectly self-consistent attacker payload: the tarball's SHA-256 equals
      // the manifest's self-declared checksum, so the unfixed self-referential
      // checksum gate passes trivially. The signature is bogus and is never checked
      // because no publicKey is configured (default-open).
      const tarball = makeTar([fileEntry('index.js', 'module.exports = { pwned: true };')]);
      const checksum = createHash('sha256').update(tarball).digest('hex');
      const maliciousManifest = {
        name: 'evil-plugin',
        version: '1.0.0',
        checksum,
        signature: Buffer.from('not-a-real-signature').toString('base64'),
        tarballUrl: 'https://registry.streetjs.dev/evil.tgz',
      };

      const stub = new RegistryStub({
        registryUrl: 'https://registry.streetjs.dev',
        tarballUrl: maliciousManifest.tarballUrl,
        manifest: maliciousManifest,
        tarball,
      });

      const installer = makeInstaller(pluginsDir); // no publicKey → default-open
      stub.attachTo(installer);

      await assert.doesNotReject(
        () => installer.install('evil-plugin', '1.0.0'),
        'EXPECTED (unfixed): install proceeds with no signature verification',
      );

      // Counterexamples: the install reached BOTH the download and extract stages
      // despite there being no trust anchor and only a self-referential checksum.
      assert.equal(stub.downloadReached, true, 'EXPECTED (unfixed): tarball was downloaded');
      assert.equal(stub.extractReached, true, 'EXPECTED (unfixed): tarball was extracted');
      assert.equal(
        existsSync(path.join(pluginsDir, 'evil-plugin@1.0.0', 'index.js')),
        true,
        'EXPECTED (unfixed): malicious plugin extracted to pluginsDir/<name>@<version>/',
      );
    } finally {
      await cleanup();
    }
  });
});
