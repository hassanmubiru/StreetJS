// packages/core/tests/plugin-installer-preservation.test.ts
//
// Feature: plugin-installer-hardening, Property 3: Preservation —
//   Identical Behavior on Non-Buggy Inputs.
//
// OBSERVATION-FIRST PRESERVATION TESTS — written BEFORE the fix, against the
// UNFIXED `registry.ts`. Per the bugfix methodology and task 3, these tests
// capture the behavior of the UNFIXED code for NON-BUGGY inputs (well-formed
// in-containment archives, a valid signed https install, and the untouched
// fail-closed `installThroughRegistry` path). They MUST PASS on the current
// unfixed code now, AND must still pass after the PS-1/PS-2 fix lands — that is
// the whole point of a preservation test: the fix must not change behavior for
// inputs that never triggered a bug condition.
//
// What each block captures as the baseline-to-preserve:
//   • In-containment extraction (raw + gzip), Req 3.1/3.2/3.3 — every file/dir
//     lands at `path.join(destDir, name.replace(/^\.\//,'').replace(/^\//,''))`,
//     a single leading `./` or `/` is normalized away, and the SAME archive in
//     raw and gzip form extracts to a byte-identical tree.
//   • Valid signed https install, Req 3.4/3.5 — a manifest signed with a
//     generated keypair (verified against the supplied public key) whose
//     downloaded tarball's SHA-256 equals the recomputed canonical checksum
//     installs successfully to `pluginsDir/<name>@<version>/` (observed layout
//     asserted exactly).
//   • `installThroughRegistry` fail-closed baseline, Req 3.7 / S7 — the
//     `local-registry.ts` path still refuses without `host.verifiesSignatures()`
//     and still installs a valid signed record. This fix must not change it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import fc from 'fast-check';

import { PluginInstaller } from '../src/platform/plugins/registry.js';
import {
  PluginHost,
  PluginError,
  signManifest,
  type PluginManifest,
} from '../src/platform/plugins/host.js';
import {
  LocalPluginRegistry,
  installThroughRegistry,
} from '../src/platform/plugins/local-registry.js';
import { PluginModule, type SandboxedApp } from '../src/platform/plugins/sdk.js';
import {
  makeTar,
  gzip,
  type TarEntry,
} from './helpers/plugin-archive.js';
import {
  generateKeypair,
  exportPublicKeyPem,
  signInstallerManifest,
  RegistryStub,
  withTempDir,
} from './helpers/plugin-registry-stub.js';

// ── Shared internals view + helpers ──────────────────────────────────────────

/** Minimal view onto the installer's private surface exercised by these tests. */
interface InstallerInternals {
  _extractTarball(buffer: Buffer, destDir: string): Promise<void>;
}

function internalsOf(installer: PluginInstaller): InstallerInternals {
  return installer as unknown as InstallerInternals;
}

/** A minimal concrete plugin (PluginModule is abstract — only name/version). */
class TestPlugin extends PluginModule {
  constructor(readonly name: string, readonly version: string) {
    super();
  }
  async onLoad(_app: SandboxedApp): Promise<void> {
    /* no-op */
  }
}

/**
 * Replicate host.ts's private `canonicalManifest` EXACTLY so a test can build
 * the byte preimage whose SHA-256 equals `manifestChecksum(body)`. The fix does
 * not change `canonicalManifest`, so this stays stable across the fix. Used to
 * construct a tarball whose SHA-256 == the recomputed canonical checksum, which
 * is exactly the integrity binding both the unfixed and fixed installer enforce.
 */
function canonicalManifestString(m: PluginManifest): string {
  const body = {
    name: m.name,
    version: m.version,
    capabilities: [...(m.capabilities ?? [])].sort(),
    permissions: [...(m.permissions ?? [])].sort(),
    dependencies: Object.fromEntries(
      Object.entries(m.dependencies ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  };
  return JSON.stringify(body);
}

/** Normalize an entry name the way the unfixed extractor does (single leading ./ or /). */
function normalizeEntryName(name: string): string {
  return name.replace(/^\.\//, '').replace(/^\//, '');
}

/**
 * Snapshot a directory tree as a sorted list of [relativePath, kind+contentHash]
 * pairs, so two extraction roots can be compared for byte-identical layout.
 */
async function snapshotTree(root: string): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push([r, 'dir']);
        await walk(abs, r);
      } else {
        const buf = await fs.readFile(abs);
        out.push([r, `file:${createHash('sha256').update(buf).digest('hex')}`]);
      }
    }
  }
  await walk(root, '');
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}

/** True if `a` and `b` are equal or one is a directory-ancestor of the other. */
function pathsConflict(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

// ── Property 3 (a): in-containment extraction, raw + gzip ─────────────────────

describe('Property 3 — Preservation: in-containment extraction (raw + gzip) [UNFIXED baseline]', () => {
  const SAFE_SEGMENT = fc.constantFrom(
    'a', 'b', 'c', 'lib', 'src', 'dist', 'util', 'core', 'pkg',
    'index.js', 'main.js', 'readme.txt', 'x', 'y', 'z',
  );

  const entryArb = fc.record({
    segments: fc.array(SAFE_SEGMENT, { minLength: 1, maxLength: 3 }),
    // A single leading "./" or "/" must still normalize + extract in-containment.
    prefix: fc.constantFrom('', './', '/'),
    kind: fc.constantFrom<'file' | 'dir'>('file', 'dir'),
    content: fc.string({ maxLength: 24 }),
  });

  // Feature: plugin-installer-hardening, Property 3: well-formed in-containment
  //   archives extract every file/dir to path.join(destDir, normalize(name)) and
  //   the same archive raw vs gzip extracts to a byte-identical tree (Req 3.1/3.2/3.3).
  it('extracts in-bounds files/dirs to their expected paths, identically for raw and gzip', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(entryArb, { minLength: 0, maxLength: 8 }), async (rawEntries) => {
        // Build a conflict-free (antichain) set so no file/dir collides on disk;
        // this keeps the archive well-formed and in-containment (NOT a bug input).
        const kept: Array<{ name: string; norm: string; kind: 'file' | 'dir'; content: string }> = [];
        for (const e of rawEntries) {
          const norm = e.segments.join('/');
          if (kept.some((k) => pathsConflict(k.norm, norm))) continue;
          kept.push({ name: `${e.prefix}${norm}`, norm, kind: e.kind, content: e.content });
        }

        const tarEntries: TarEntry[] = kept.map((k) =>
          k.kind === 'file'
            ? { name: k.name, typeFlag: '0', data: k.content }
            : { name: k.name, typeFlag: '5' },
        );
        const rawTar = makeTar(tarEntries);
        const gzTar = gzip(rawTar);

        const { dir: root, cleanup } = await withTempDir();
        try {
          const destRaw = path.join(root, 'raw');
          const destGz = path.join(root, 'gz');
          await fs.mkdir(destRaw, { recursive: true });
          await fs.mkdir(destGz, { recursive: true });

          const installer = new PluginInstaller({ pluginsDir: root });
          await internalsOf(installer)._extractTarball(rawTar, destRaw);
          await internalsOf(installer)._extractTarball(gzTar, destGz);

          // Req 3.3: raw and gzip forms of the SAME archive extract identically.
          assert.deepEqual(await snapshotTree(destRaw), await snapshotTree(destGz));

          // Req 3.1/3.2: every entry landed at the expected normalized location.
          for (const k of kept) {
            const expected = path.join(destRaw, normalizeEntryName(k.name));
            const st = await fs.stat(expected);
            if (k.kind === 'file') {
              assert.equal(st.isFile(), true, `expected file at ${expected}`);
              assert.equal(await fs.readFile(expected, 'utf8'), k.content);
            } else {
              assert.equal(st.isDirectory(), true, `expected directory at ${expected}`);
            }
          }
        } finally {
          await cleanup();
        }
      }),
      { numRuns: 200 },
    );
  });
});

// ── Property 3 (b): valid signed https install ────────────────────────────────

describe('Property 3 — Preservation: valid signed https install [UNFIXED baseline]', () => {
  // Feature: plugin-installer-hardening, Property 3: a properly signed,
  //   schema-valid https manifest whose downloaded tarball's SHA-256 equals the
  //   recomputed canonical checksum installs to pluginsDir/<name>@<version>/ (Req 3.4/3.5).
  it('installs a signed https plugin verified against the supplied public key', async () => {
    const { dir: pluginsDir, cleanup } = await withTempDir();
    try {
      const { publicKey, privateKey } = generateKeypair();
      const publicKeyPem = exportPublicKeyPem(publicKey);

      const body: PluginManifest = {
        name: 'preserve-plugin',
        version: '1.0.0',
        capabilities: ['metrics'],
        permissions: ['events'],
        dependencies: { logger: '^1.0.0' },
      };
      // Sign via host.ts's signManifest (canonical checksum + Ed25519 signature),
      // then attach the https tarball URL (outside the signed body — S1/S2).
      const manifest = signInstallerManifest(
        body,
        privateKey,
        'https://registry.streetjs.dev/preserve-plugin-1.0.0.tgz',
      );

      // The tarball whose SHA-256 == the recomputed canonical checksum is the
      // canonical manifest body preimage. This is the integrity binding the
      // installer enforces (sha256(tarball) === manifest checksum).
      const tarball = Buffer.from(canonicalManifestString(body), 'utf8');
      assert.equal(
        createHash('sha256').update(tarball).digest('hex'),
        manifest.checksum,
        'sanity: tarball SHA-256 must equal the recomputed canonical checksum',
      );

      const installer = new PluginInstaller({ pluginsDir, publicKey: publicKeyPem });
      const stub = new RegistryStub({
        registryUrl: 'https://registry.streetjs.dev',
        tarballUrl: manifest.tarballUrl,
        manifest,
        tarball,
      });
      stub.attachTo(installer);

      // Valid signed https install must SUCCEED (signature verifies, checksum matches).
      await assert.doesNotReject(() => installer.install('preserve-plugin', '1.0.0'));

      // The full pipeline ran: signature verify → download → checksum → extract.
      assert.equal(stub.downloadReached, true, 'tarball was downloaded');
      assert.equal(stub.extractReached, true, 'tarball was extracted');

      // Observed layout: the plugin extracts to pluginsDir/<name>@<version>/.
      const destDir = path.join(pluginsDir, 'preserve-plugin@1.0.0');
      const st = await fs.stat(destDir);
      assert.equal(st.isDirectory(), true, 'destDir pluginsDir/<name>@<version>/ exists');
      // Observed-on-unfixed exact layout: the <512-byte canonical preimage carries
      // no parseable tar entry, so the destination directory is created and empty.
      assert.deepEqual(await snapshotTree(destDir), [], 'observed unfixed layout: empty plugin dir');
    } finally {
      await cleanup();
    }
  });
});

// ── Property 3 (c): installThroughRegistry fail-closed baseline ───────────────

describe('Property 3 — Preservation: installThroughRegistry fail-closed [UNFIXED baseline, Req 3.7 / S7]', () => {
  function publishedRegistry(): {
    registry: LocalPluginRegistry;
    publicKeyPem: string;
    publicKey: ReturnType<typeof generateKeypair>['publicKey'];
    plugin: TestPlugin;
  } {
    const { publicKey, privateKey } = generateKeypair();
    const publicKeyPem = exportPublicKeyPem(publicKey);
    const base: PluginManifest = {
      name: 'registry-plugin',
      version: '2.0.0',
      capabilities: ['payments'],
      permissions: ['db'],
    };
    const signed = signManifest(base, privateKey);
    const registry = new LocalPluginRegistry();
    registry.publish(signed, publicKeyPem);
    return { registry, publicKeyPem, publicKey, plugin: new TestPlugin('registry-plugin', '2.0.0') };
  }

  // Feature: plugin-installer-hardening, Property 3: installThroughRegistry stays
  //   fail-closed — it refuses when the host does not verify signatures (Req 3.7 / S7).
  it('refuses to install when the host does not enforce signature verification', async () => {
    const { registry, plugin } = publishedRegistry();
    const host = new PluginHost(); // no publicKey → verifiesSignatures() === false
    assert.equal(host.verifiesSignatures(), false);

    await assert.rejects(
      () => installThroughRegistry(registry, host, plugin),
      (err: unknown) => {
        assert.ok(err instanceof PluginError, 'expected a PluginError refusal');
        return true;
      },
    );
    assert.equal(host.has('registry-plugin'), false, 'nothing registered on refusal');
  });

  // Feature: plugin-installer-hardening, Property 3: installThroughRegistry still
  //   installs a valid signed record when the host enforces signatures (Req 3.7 / S7).
  it('installs a valid signed record when the host enforces signature verification', async () => {
    const { registry, publicKey, plugin } = publishedRegistry();
    const host = new PluginHost({ publicKey }); // enforces signature verification
    assert.equal(host.verifiesSignatures(), true);

    const result = await installThroughRegistry(registry, host, plugin);

    assert.equal(result.record.manifest.name, 'registry-plugin');
    assert.equal(result.record.manifest.version, '2.0.0');
    assert.equal(host.has('registry-plugin'), true, 'plugin registered through the host');
    assert.equal(host.state('registry-plugin'), 'enabled', 'plugin enabled by default');
  });
});
