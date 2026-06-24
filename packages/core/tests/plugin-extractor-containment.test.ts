// packages/core/tests/plugin-extractor-containment.test.ts
//
// Feature: plugin-installer-hardening, Property 1: extractor path containment
//   (PS-1 — zip-slip in `_extractTarball`).
//
// FIX-CHECKING PROPERTY TEST — runs against the FIXED `registry.ts`
// (`resolveContained` + two-pass, abort-before-write `_extractTarball`).
//
// Property 1 (design "Correctness Properties"):
//   For any archive and destDir where the extraction bug condition holds
//   (`isBugConditionExtract` returns true — some entry contains a `..` segment,
//   is absolute, resolves outside `path.resolve(destDir)`, or has a link
//   type-flag `'1'`/`'2'`), the fixed `_extractTarball` SHALL reject the archive
//   by throwing AND leave no file written outside `path.resolve(destDir)`.
//   Conversely, for any archive whose every entry is an in-containment file/dir,
//   every written path SHALL resolve inside `path.resolve(destDir)` and
//   extraction SHALL succeed.
//
// Validates: Requirements 2.1, 2.2, 2.3, 2.4

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import fc from 'fast-check';

import { PluginInstaller } from '../src/platform/plugins/registry.js';
import {
  makeTar,
  gzip,
  type TarEntry,
  type TarTypeFlag,
} from './helpers/plugin-archive.js';
import { withTempDir } from './helpers/plugin-registry-stub.js';

// ── Internals view ────────────────────────────────────────────────────────────

/** Minimal view onto the installer's private extractor exercised by this test. */
interface InstallerInternals {
  _extractTarball(buffer: Buffer, destDir: string): Promise<void>;
}

function internalsOf(installer: PluginInstaller): InstallerInternals {
  return installer as unknown as InstallerInternals;
}

// ── isBugConditionExtract — the design's formal predicate ─────────────────────
//
// Mirrors the design / bugfix `isBugConditionExtract(archive, destDir)` exactly,
// computed the same way the fixed `resolveContained` sanitizes (strip a SINGLE
// leading "./" and "/", preserving Req 3.2). An archive triggers the bug iff
// some entry: has a link type-flag ('1'/'2'), is absolute after sanitization,
// contains a ".." path segment, or resolves outside `path.resolve(destDir)`.

function sanitize(entryName: string): string {
  return entryName.replace(/^\.\//, '').replace(/^\//, '');
}

function isBugConditionExtract(entries: TarEntry[], destDir: string): boolean {
  const destRoot = path.resolve(destDir);
  for (const entry of entries) {
    // Link type-flags are never permitted (Req 2.3).
    if (entry.typeFlag === '1' || entry.typeFlag === '2') return true;

    const sanitized = sanitize(entry.name);
    // Absolute path that survives the single-leading-slash strip (Req 2.2).
    if (path.isAbsolute(sanitized)) return true;
    // Any ".." path segment (Req 2.1).
    if (sanitized.split(/[\\/]/).includes('..')) return true;

    // Resolves outside the extraction root (Req 2.4).
    const resolved = path.resolve(destDir, sanitized);
    const isContained = resolved === destRoot || resolved.startsWith(destRoot + path.sep);
    if (!isContained) return true;
  }
  return false;
}

// ── Filesystem walk helper ────────────────────────────────────────────────────

/** Collect every absolute path (files AND directories) under `root`. */
async function walkAll(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  async function walk(dir: string): Promise<void> {
    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of dirents) {
      const abs = path.resolve(dir, d.name);
      out.add(abs);
      if (d.isDirectory()) await walk(abs);
    }
  }
  await walk(root);
  return out;
}

function isOutside(destRoot: string, p: string): boolean {
  const resolved = path.resolve(p);
  return resolved !== destRoot && !resolved.startsWith(destRoot + path.sep);
}

// ── Generators ────────────────────────────────────────────────────────────────

const SAFE_SEGMENT = fc.constantFrom(
  'a', 'b', 'c', 'lib', 'src', 'dist', 'pkg', 'core', 'util',
  'index.js', 'main.js', 'readme.txt', 'x', 'y', 'z',
);

/** A well-formed, in-containment file or directory entry. */
const inBoundsArb = fc.record({
  segments: fc.array(SAFE_SEGMENT, { minLength: 1, maxLength: 3 }),
  // A single leading "./" or "/" must still normalize + extract in-containment.
  prefix: fc.constantFrom('', './', '/'),
  kind: fc.constantFrom<'file' | 'dir'>('file', 'dir'),
  content: fc.string({ maxLength: 16 }),
});

/** A `..`-traversal file entry of random depth (escapes the extraction root). */
const traversalAdversaryArb = fc
  .record({
    depth: fc.integer({ min: 1, max: 3 }),
    tail: fc.constantFrom('evil.txt', 'escape.sh', 'pwn.js'),
  })
  .map(({ depth, tail }): TarEntry => ({
    name: '../'.repeat(depth) + tail,
    typeFlag: '0',
    data: 'pwned-traversal',
  }));

/**
 * An absolute-path file entry that REMAINS absolute after the single-leading-
 * slash strip (double leading slash), so it is genuinely rejected by the fix
 * rather than silently re-contained.
 */
const absoluteAdversaryArb = fc
  .constantFrom('//tmp/streetjs-evil.txt', '//etc/streetjs-evil.conf', '//var/streetjs-evil')
  .map((name): TarEntry => ({ name, typeFlag: '0', data: 'pwned-absolute' }));

/** A link entry (symlink '2' or hardlink '1') — always rejected (Req 2.3). */
const linkAdversaryArb = fc
  .record({
    flag: fc.constantFrom<TarTypeFlag>('1', '2'),
    name: fc.constantFrom('link', 'hard', 'ln'),
    linkname: fc.constantFrom('/etc/passwd', 'target', '/tmp/x'),
  })
  .map(({ flag, name, linkname }): TarEntry => ({ name, typeFlag: flag, linkname }));

const adversaryArb = fc.oneof(traversalAdversaryArb, absoluteAdversaryArb, linkAdversaryArb);

/** True if `a` and `b` are equal or one is a directory-ancestor of the other. */
function pathsConflict(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

// ── Property 1 — extractor path containment ───────────────────────────────────

describe('Property 1 — extractor path containment (PS-1, fixed _extractTarball)', () => {
  // Feature: plugin-installer-hardening, Property 1: extractor path containment.
  // Validates: Requirements 2.1, 2.2, 2.3, 2.4
  it('rejects (throws, writes nothing outside destDir) iff isBugConditionExtract, else extracts in-containment', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          inBounds: fc.array(inBoundsArb, { maxLength: 6 }),
          adversaries: fc.array(adversaryArb, { maxLength: 4 }),
          adversariesFirst: fc.boolean(),
          useGzip: fc.boolean(),
        }),
        async ({ inBounds, adversaries, adversariesFirst, useGzip }) => {
          // Build a conflict-free (antichain) set of in-bounds entries so the
          // happy-path write never errors on a file/dir collision (which would
          // be a spurious throw unrelated to containment).
          const kept: Array<{ name: string; norm: string; kind: 'file' | 'dir'; content: string }> = [];
          for (const e of inBounds) {
            const norm = e.segments.join('/');
            if (kept.some((k) => pathsConflict(k.norm, norm))) continue;
            kept.push({ name: `${e.prefix}${norm}`, norm, kind: e.kind, content: e.content });
          }
          const inBoundsEntries: TarEntry[] = kept.map((k) =>
            k.kind === 'file'
              ? { name: k.name, typeFlag: '0', data: k.content }
              : { name: k.name, typeFlag: '5' },
          );

          const entries: TarEntry[] = adversariesFirst
            ? [...adversaries, ...inBoundsEntries]
            : [...inBoundsEntries, ...adversaries];

          const rawTar = makeTar(entries);
          const tar = useGzip ? gzip(rawTar) : rawTar;

          const { dir: root, cleanup } = await withTempDir();
          try {
            // Nest destDir several levels deep so even depth-3 traversal stays
            // within the temp root (never touching the real filesystem).
            const destDir = path.join(root, 'l1', 'l2', 'l3', 'l4', 'pkg@1.0.0');
            await fs.mkdir(destDir, { recursive: true });
            const destRoot = path.resolve(destDir);

            // Evaluate the predicate against the REAL destDir.
            const isBug = isBugConditionExtract(entries, destDir);

            const before = await walkAll(root);

            const installer = new PluginInstaller({ pluginsDir: root });
            let threw = false;
            try {
              await internalsOf(installer)._extractTarball(tar, destDir);
            } catch {
              threw = true;
            }

            const after = await walkAll(root);
            const created = [...after].filter((p) => !before.has(p));

            if (isBug) {
              // Property 1 (bug branch): reject by throwing …
              assert.equal(threw, true, 'expected _extractTarball to throw on a bug-condition archive');
              // … and leave NO path written outside path.resolve(destDir).
              const escaped = created.filter((p) => isOutside(destRoot, p));
              assert.deepEqual(
                escaped,
                [],
                `expected no out-of-containment artifact; found: ${escaped.join(', ')}`,
              );
            } else {
              // Property 1 (non-bug branch): extraction succeeds …
              assert.equal(threw, false, 'expected in-containment archive to extract without throwing');
              // … and every written path resolves inside destDir.
              for (const p of created) {
                assert.equal(
                  isOutside(destRoot, p),
                  false,
                  `written path escaped destDir: ${p}`,
                );
              }
              // Every in-bounds entry landed at its expected normalized location.
              for (const k of kept) {
                const expected = path.join(destDir, sanitize(k.name));
                const st = await fs.stat(expected);
                if (k.kind === 'file') {
                  assert.equal(st.isFile(), true, `expected file at ${expected}`);
                  assert.equal(await fs.readFile(expected, 'utf8'), k.content);
                } else {
                  assert.equal(st.isDirectory(), true, `expected directory at ${expected}`);
                }
              }
            }
          } finally {
            await cleanup();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
