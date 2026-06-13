// create-templates.test.ts
// Unit tests for `street create --template <variant>`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreateCommand, TEMPLATES } from '../commands/create.js';

function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'street-tpl-test-'));
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

describe('street create --template', () => {
  it('rejects an unknown template', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { template: 'bogus' })); } finally { restore(); }
      assert.equal(process.exitCode, 1);
      process.exitCode = 0;
    });
  });

  it('default (app) template produces no features dir or TEMPLATE.md', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['myapp'])); } finally { restore(); }
      assert.ok(existsSync(join(dir, 'myapp', 'package.json')));
      assert.ok(!existsSync(join(dir, 'myapp', 'TEMPLATE.md')));
      assert.ok(!existsSync(join(dir, 'myapp', 'src', 'features')));
      assert.equal(process.exitCode, 0);
    });
  });

  for (const [variant, spec] of Object.entries(TEMPLATES)) {
    if (variant === 'app') continue;
    it(`${variant} template adds its package + starter module`, async () => {
      await withTempDir(async (dir) => {
        const restore = capture();
        try { await new CreateCommand().execute(ctx(dir, ['proj'], { template: variant })); } finally { restore(); }
        assert.equal(process.exitCode, 0);
        const proj = join(dir, 'proj');
        // package.json contains the variant's dependencies.
        const pkg = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf8'));
        for (const dep of Object.keys(spec.packages)) {
          assert.ok(pkg.dependencies[dep], `package.json should depend on ${dep}`);
        }
        // starter module written.
        assert.ok(existsSync(join(proj, spec.starter.path)), `${spec.starter.path} should exist`);
        // TEMPLATE.md written.
        assert.ok(existsSync(join(proj, 'TEMPLATE.md')));
      });
    });
  }
});
