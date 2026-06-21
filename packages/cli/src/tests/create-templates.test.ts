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

describe('street create --starter (alias of --template)', () => {
  it('--starter saas behaves like --template saas', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { starter: 'saas' })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const proj = join(dir, 'proj');
      assert.ok(existsSync(join(proj, TEMPLATES.saas.starter.path)), 'saas starter module should exist');
      const pkg = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf8'));
      assert.ok(pkg.dependencies['@streetjs/admin'], 'should depend on @streetjs/admin');
    });
  });

  it('saas starter scaffolds the schema migration, SAAS.md and billing env sample', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { starter: 'saas' })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const proj = join(dir, 'proj');
      assert.ok(existsSync(join(proj, 'migrations', '001_saas.sql')), 'schema migration should exist');
      assert.ok(existsSync(join(proj, 'SAAS.md')), 'SAAS.md should exist');
      assert.ok(existsSync(join(proj, '.env.saas.example')), 'billing env sample should exist');
      const sql = readFileSync(join(proj, 'migrations', '001_saas.sql'), 'utf8');
      for (const t of ['organizations', 'memberships', 'invitations', 'subscriptions', 'audit_logs']) {
        assert.ok(sql.includes(t), `migration should define ${t}`);
      }
    });
  });

  it('--starter ai scaffolds the AI starter', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { starter: 'ai' })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const proj = join(dir, 'proj');
      assert.ok(existsSync(join(proj, 'src', 'features', 'ai.ts')), 'ai starter module should exist');
      const pkg = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf8'));
      assert.ok(pkg.dependencies['@streetjs/ai'], 'should depend on @streetjs/ai');
    });
  });

  it('resolves friendly aliases (realtime -> realtime-chat)', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['rt'], { starter: 'realtime' })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      assert.ok(existsSync(join(dir, 'rt', TEMPLATES['realtime-chat'].starter.path)), 'realtime alias should scaffold realtime-chat');
    });
  });

  it('realtime starter scaffolds channels/messages migration + REALTIME.md', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['rt'], { starter: 'realtime' })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const proj = join(dir, 'rt');
      assert.ok(existsSync(join(proj, 'migrations', '001_realtime.sql')), 'realtime migration should exist');
      assert.ok(existsSync(join(proj, 'REALTIME.md')), 'REALTIME.md should exist');
      const sql = readFileSync(join(proj, 'migrations', '001_realtime.sql'), 'utf8');
      for (const t of ['channels', 'channel_members', 'messages']) assert.ok(sql.includes(t), `migration should define ${t}`);
    });
  });

  it('marketplace starter scaffolds the commerce migration + COMMERCE.md', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['mk'], { starter: 'marketplace' })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const proj = join(dir, 'mk');
      assert.ok(existsSync(join(proj, 'migrations', '001_commerce.sql')), 'commerce migration should exist');
      assert.ok(existsSync(join(proj, 'COMMERCE.md')), 'COMMERCE.md should exist');
      const sql = readFileSync(join(proj, 'migrations', '001_commerce.sql'), 'utf8');
      for (const t of ['products', 'inventory', 'carts', 'orders', 'payments']) assert.ok(sql.includes(t), `migration should define ${t}`);
    });
  });

  it('rejects an unknown starter', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { starter: 'nope' })); } finally { restore(); }
      assert.equal(process.exitCode, 1);
      process.exitCode = 0;
    });
  });
});
