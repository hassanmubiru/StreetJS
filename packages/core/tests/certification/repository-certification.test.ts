// tests/certification/repository-certification.test.ts
// Certifies repository hygiene: build output is git-ignored, the npm `files`
// allowlist never ships tests or stale src builds, and shipped source carries no
// banned placeholder markers.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(import.meta.url);
const coreRoot = join(here, '..', '..', '..', '..'); // packages/core
const repoRoot = join(coreRoot, '..', '..');

describe('REPOSITORY — build-output hygiene', () => {
  it('.gitignore excludes build output (dist)', () => {
    const gi = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    assert.match(gi, /^dist\/$/m);
    assert.match(gi, /packages\/\*\/dist\//m);
  });

  it('npm `files` allowlist excludes tests and dist/src', () => {
    const pkg = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')) as { files: string[] };
    for (const f of pkg.files) {
      // `!`-prefixed entries are allowlist *exclusions* (e.g. `!dist/**/*.test.js`,
      // `!dist/tests/**`) — they subtract files from the tarball, so they are the
      // opposite of "publishing" and must not be flagged here.
      if (f.startsWith('!')) continue;
      assert.ok(!f.includes('dist/tests'), `files must not publish tests: ${f}`);
      assert.ok(!f.startsWith('dist/src/'), `files must not publish dist/src: ${f}`);
    }
  });

  it('package.json exports declare a browser condition for the main entry', () => {
    const pkg = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')) as { exports: Record<string, Record<string, string>> };
    assert.ok(pkg.exports['.']?.['browser'], 'main entry has browser condition');
    assert.ok(pkg.exports['.']?.['import'], 'main entry has import condition');
  });
});

describe('REPOSITORY — no banned placeholder markers in shipped source', () => {
  const banned = /\b(TODO|FIXME|HACK)\b|@ts-ignore/;

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      if (e === 'tests' || e === 'integration' || e === 'benchmarks') continue;
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) out.push(...walk(p));
      else if (e.endsWith('.ts')) out.push(p);
    }
    return out;
  }

  it('src/ contains no TODO/FIXME/HACK/@ts-ignore', () => {
    const offenders: string[] = [];
    for (const file of walk(join(coreRoot, 'src'))) {
      const txt = readFileSync(file, 'utf8');
      if (banned.test(txt)) offenders.push(file.replace(coreRoot, '.'));
    }
    assert.deepEqual(offenders, [], `banned markers found in: ${offenders.join(', ')}`);
  });
});
