// create-frontend.test.ts
// Unit tests for `street create --frontend <react|next>` and the CI workflow.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreateCommand } from '../commands/create.js';

function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'street-fe-test-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function capture() {
  const ol = console.log, oe = console.error;
  console.log = () => {}; console.error = () => {};
  return () => { console.log = ol; console.error = oe; };
}

function ctx(cwd: string, positional: string[], flags: Record<string, string | boolean> = {}) {
  process.exitCode = 0;
  return { cwd, args: { command: 'create', positional, flags: { 'no-lockfile': true, ...flags } } };
}

describe('street create --frontend', () => {
  it('rejects an unknown frontend', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { frontend: 'svelte' })); } finally { restore(); }
      assert.equal(process.exitCode, 1);
      process.exitCode = 0;
    });
  });

  it('default scaffold has no web/ but always gets a CI workflow', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'])); } finally { restore(); }
      const proj = join(dir, 'proj');
      assert.ok(!existsSync(join(proj, 'web')), 'no web/ by default');
      assert.ok(existsSync(join(proj, '.github', 'workflows', 'ci.yml')), 'ci.yml present');
      const ci = readFileSync(join(proj, '.github', 'workflows', 'ci.yml'), 'utf8');
      assert.ok(ci.includes('backend:'), 'backend job present');
      assert.ok(!ci.includes('web:'), 'no web job without a frontend');
    });
  });

  it('react frontend scaffolds a Vite SPA wired to @streetjs/react', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { frontend: 'react' })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const web = join(dir, 'proj', 'web');
      assert.ok(existsSync(join(web, 'package.json')));
      assert.ok(existsSync(join(web, 'src', 'main.tsx')));
      assert.ok(existsSync(join(web, 'src', 'App.tsx')));
      assert.ok(existsSync(join(web, 'vite.config.ts')));
      const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
      assert.ok(pkg.dependencies['@streetjs/react'], 'depends on @streetjs/react');
      assert.ok(pkg.dependencies['@streetjs/client'], 'depends on @streetjs/client');
      const ci = readFileSync(join(dir, 'proj', '.github', 'workflows', 'ci.yml'), 'utf8');
      assert.ok(ci.includes('web:'), 'web job present for react frontend');
    });
  });

  it('next frontend scaffolds an App Router app + @streetjs/next', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { frontend: 'next' })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const web = join(dir, 'proj', 'web');
      assert.ok(existsSync(join(web, 'app', 'page.tsx')));
      assert.ok(existsSync(join(web, 'app', 'layout.tsx')));
      assert.ok(existsSync(join(web, 'app', 'providers.tsx')));
      assert.ok(existsSync(join(web, 'next.config.mjs')));
      const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
      assert.ok(pkg.dependencies['@streetjs/next'], 'depends on @streetjs/next');
      assert.ok(pkg.dependencies['next'], 'depends on next');
    });
  });
});
