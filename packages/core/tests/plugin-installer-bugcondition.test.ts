// packages/core/tests/plugin-installer-bugcondition.test.ts
//
// Feature: plugin-installer-hardening, Property 1: Bug Condition
//   PS-1 (zip-slip in `_extractTarball`) + PS-2 (default-open install gate).
//
// EXPLORATION TESTS — originally written BEFORE any fix, against the UNFIXED
// `registry.ts` (task 2). Per the design "Exploratory Bug Condition Checking"
// section, these assertions originally CHARACTERIZED the buggy behavior and
// PASSED on the unfixed code (confirming PS-1 and PS-2 exist with concrete
// counterexamples). They were EXPECTED TO FLIP once each fix lands.
//
// CURRENT STATE:
//   • PS-1 IS FIXED (task 4: `resolveContained` + two-pass `_extractTarball`).
//     The PS-1 assertions below (Bug 1.1 traversal, Bug 1.2 absolute, Bug 1.3
//     link type-flags) have been FLIPPED (task 4.4) to assert the closed-bug
//     REJECTION behavior: the extractor now throws and writes nothing on every
//     adversarial archive. These now CONFIRM PS-1 is CLOSED.
//   • PS-2 IS NOW FIXED (task 5: fail-closed, front-loaded install gate). The
//     PS-2 default-open case below has been FLIPPED (task 5.4) to assert the
//     closed-bug REJECTION behavior: with no `publicKey` and no `allowUnsigned`,
//     the trust anchor defaults to the official key, `verifyManifest` rejects the
//     self-signed malicious manifest, and `install()` THROWS at the signature
//     gate BEFORE any download or extraction (Req 2.5, 2.6, 2.9). These now
//     CONFIRM PS-2 is CLOSED.
//
// Documented counterexamples (the original proof the bugs existed) and how the
// fix closes each case:
//   • PS-1 / Bug 1.1 — a tar entry named `../../evil.txt` used to be written to
//     `path.resolve(destDir, '../../evil.txt')`, OUTSIDE `path.resolve(destDir)`.
//     FIXED: the validation pre-pass rejects the `..` segment → throws, nothing
//     written outside the extraction root.
//   • PS-1 / Bug 1.2 — an absolute-path entry (`//abs/evil.txt`) used to be
//     silently re-contained and written with no absolute-path guard. FIXED:
//     `resolveContained` rejects the absolute path → throws, nothing written.
//   • PS-1 / Bug 1.3 — symlink (`'2'`) and hardlink (`'1'`) type-flags used to be
//     silently ignored (no throw), leaving link-based traversal unguarded. FIXED:
//     the pre-pass rejects link type-flags → throws, nothing written.
//   • PS-2 / Bug 1.5-1.6 — `new PluginInstaller({ pluginsDir })` with no
//     `publicKey` used to install a self-consistent malicious manifest+tarball
//     (tarball SHA-256 == manifest.checksum) and proceed to download AND extract
//     with NO signature verification (default-open + self-referential checksum).
//     FIXED: the trust anchor now defaults to `officialPluginPublicKey()`, so the
//     bogus self-signed signature fails `verifyManifest` and `install()` aborts
//     at the signature gate BEFORE download/extract — no filesystem side effects,
//     even though the payload is self-consistent (no trust-anchor waiver and the
//     signature does not verify against the default official key).

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

describe('PS-1 + PS-2 bugs closed (exploration assertions flipped to confirm rejection)', () => {
  // ── PS-1 / Bug 1.1 — `..` traversal now REJECTED (bug CLOSED) ──────────────
  it('PS-1 Bug 1.1 (CLOSED): a `../../evil.txt` entry now THROWS and writes nothing outside path.resolve(destDir)', async () => {
    const { dir: root, cleanup } = await withTempDir();
    try {
      const pluginsDir = path.join(root, 'pluginsDir');
      const destDir = path.join(pluginsDir, 'evil@1.0.0');
      await fs.mkdir(destDir, { recursive: true });

      // Original counterexample archive: one entry `../../evil.txt`.
      const tar = makeTar([traversalEntry('../../evil.txt', 'pwned')]);

      const installer = makeInstaller(pluginsDir);
      // FIXED: the validation pre-pass rejects the `..` segment before any write.
      await assert.rejects(
        () => internalsOf(installer)._extractTarball(tar, destDir),
        /path-traversal/i,
        'FIXED: traversal entry must now be rejected by throwing',
      );

      // No out-of-containment artifact: path.resolve(destDir, '../../evil.txt')
      // === <root>/evil.txt must NOT exist.
      const escaped = path.resolve(destDir, '../../evil.txt');
      assert.equal(
        await pathExistsOutside(destDir, escaped),
        false,
        `FIXED: no traversal artifact must exist outside destDir at ${escaped}`,
      );
    } finally {
      await cleanup();
    }
  });

  // ── PS-1 / Bug 1.2 — absolute path now REJECTED (bug CLOSED) ───────────────
  it('PS-1 Bug 1.2 (CLOSED): an absolute-path entry is now REJECTED (throws, nothing written)', async () => {
    const { dir: root, cleanup } = await withTempDir();
    try {
      const pluginsDir = path.join(root, 'pluginsDir');
      const destDir = path.join(pluginsDir, 'abs@1.0.0');
      await fs.mkdir(destDir, { recursive: true });

      // `//abs/evil.txt` survives the single leading-slash strip as `/abs/evil.txt`,
      // an absolute path. FIXED: `resolveContained` rejects absolute paths.
      const tar = makeTar([fileEntry('//abs/evil.txt', 'pwned-abs')]);

      const installer = makeInstaller(pluginsDir);
      await assert.rejects(
        () => internalsOf(installer)._extractTarball(tar, destDir),
        /path-traversal/i,
        'FIXED: absolute-path entry must now be rejected by throwing',
      );

      // Nothing was written: neither the re-contained location nor anywhere else.
      const recontained = path.join(destDir, 'abs', 'evil.txt');
      assert.equal(
        existsSync(recontained),
        false,
        `FIXED: absolute entry must NOT be written to ${recontained}`,
      );
      assert.deepEqual(
        await fs.readdir(destDir),
        [],
        'FIXED: extraction root must be left empty on rejection (no partial writes)',
      );
    } finally {
      await cleanup();
    }
  });

  // ── PS-1 / Bug 1.3 — link type-flags ('1'/'2') now REJECTED (bug CLOSED) ────
  it('PS-1 Bug 1.3 (CLOSED): symlink (\'2\') and hardlink (\'1\') archives now THROW (rejected, nothing written)', async () => {
    const { dir: root, cleanup } = await withTempDir();
    try {
      const pluginsDir = path.join(root, 'pluginsDir');
      const installer = makeInstaller(pluginsDir);

      // FIXED: the validation pre-pass rejects link type-flags. Each link archive
      // must throw and write nothing.
      const symDest = path.join(pluginsDir, 'sym@1.0.0');
      await fs.mkdir(symDest, { recursive: true });
      const symTar = makeTar([symlinkEntry('link', '/etc/passwd')]);
      await assert.rejects(
        () => internalsOf(installer)._extractTarball(symTar, symDest),
        /link entry/i,
        'FIXED: symlink type-flag must now be rejected by throwing',
      );
      assert.equal(existsSync(path.join(symDest, 'link')), false);
      assert.deepEqual(await fs.readdir(symDest), [], 'FIXED: nothing written on symlink rejection');

      const hardDest = path.join(pluginsDir, 'hard@1.0.0');
      await fs.mkdir(hardDest, { recursive: true });
      const hardTar = makeTar([hardlinkEntry('hard', 'target')]);
      await assert.rejects(
        () => internalsOf(installer)._extractTarball(hardTar, hardDest),
        /link entry/i,
        'FIXED: hardlink type-flag must now be rejected by throwing',
      );
      assert.equal(existsSync(path.join(hardDest, 'hard')), false);
      assert.deepEqual(await fs.readdir(hardDest), [], 'FIXED: nothing written on hardlink rejection');
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
