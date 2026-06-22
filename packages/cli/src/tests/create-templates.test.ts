// create-templates.test.ts
// Unit tests for `street create --template <variant>`.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { CreateCommand, TEMPLATES } from '../commands/create.js';

/** Recursively collect every file under `root` as { relPath -> Buffer } for
 * byte-exact scaffold comparison (paths normalized to forward slashes). */
function snapshotDir(root: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs)) {
      const full = join(abs, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(root, full).split(sep).join('/'), readFileSync(full));
    }
  };
  walk(root);
  return out;
}

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
      assert.ok(pkg.dependencies['@streetjs/plugin-htmx'], 'should depend on @streetjs/plugin-htmx');
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

  it('saas starter scaffolds the dashboard controllers + htmx view templates', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      // The auth/RBAC UI controller is opt-in behind --with-admin-ui (it imports
      // @streetjs/auth-ui + @streetjs/admin-ui). Scaffold with the flag so both
      // controllers are emitted for this assertion.
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { starter: 'saas', 'with-admin-ui': true })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const proj = join(dir, 'proj');
      // Dashboard controllers (htmx fragments + auth/RBAC composition).
      for (const f of [
        'src/modules/dashboard/dashboard.controller.ts',
        'src/modules/dashboard/auth-ui.controller.ts',
      ]) {
        assert.ok(existsSync(join(proj, f)), `${f} should exist`);
      }
      // htmx layout + role-gated 403 + the four required views (orgs, members, api keys, audit).
      for (const v of [
        'src/views/layouts/dashboard.html',
        'src/views/pages/dashboard/orgs.html',
        'src/views/pages/dashboard/members.html',
        'src/views/pages/dashboard/api-keys.html',
        'src/views/pages/dashboard/audit.html',
        'src/views/pages/dashboard/forbidden.html',
        'src/views/partials/dashboard/member-row.html',
      ]) {
        assert.ok(existsSync(join(proj, v)), `${v} should exist`);
      }
      // Composes @streetjs/auth-ui and @streetjs/admin-ui for the auth/RBAC screens.
      const authCtl = readFileSync(join(proj, 'src/modules/dashboard/auth-ui.controller.ts'), 'utf8');
      assert.ok(authCtl.includes('@streetjs/auth-ui'), 'auth-ui controller should compose @streetjs/auth-ui');
      assert.ok(authCtl.includes('@streetjs/admin-ui'), 'auth-ui controller should compose @streetjs/admin-ui');
      // Role-gating: members view renders the invite/remove actions only for owner/admin.
      const dashCtl = readFileSync(join(proj, 'src/modules/dashboard/dashboard.controller.ts'), 'utf8');
      assert.ok(dashCtl.includes("'api-keys': ['owner', 'admin']"), 'api-keys view should be owner/admin only');
      assert.ok(dashCtl.includes('dashboard/forbidden'), 'controller should render a 403 forbidden view with no data');
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

describe('saas overlay registration + alias preservation', () => {
  // The exact byte content of the 001_saas.sql migration as registered in the
  // template. Task 1 must leave this entry untouched while adding new overlay
  // entries and always-on packages.
  const saas001 = TEMPLATES.saas.extraFiles?.find((f) => f.path === 'migrations/001_saas.sql');

  it('registers the always-on composition packages and keeps the rest flag-gated', () => {
    const deps = TEMPLATES.saas.packages;
    // Always-on default: ONLY the server-rendered dashboard runtime. `streetjs`
    // itself is already the base scaffold dep, so the saas overlay adds just
    // @streetjs/plugin-htmx (published, installable, version-correct).
    assert.deepEqual(
      Object.keys(deps).sort(),
      ['@streetjs/plugin-htmx'],
      'saas always-on packages must be exactly @streetjs/plugin-htmx',
    );

    // The unpublished/unsatisfiable packages must NEVER be in the always-on set:
    //   @streetjs/admin       → 404 (not published)
    //   @streetjs/admin-ui    → only 0.1.x exists (no 1.x)
    //   @streetjs/auth-ui     → only 0.1.x exists (no 1.x)
    for (const dep of ['@streetjs/admin', '@streetjs/admin-ui', '@streetjs/auth-ui']) {
      assert.ok(!deps[dep], `${dep} must NOT be an always-on dependency`);
    }

    // Billing / email / postgres remain install-on-demand (not bundled by default).
    for (const dep of ['@streetjs/plugin-stripe', '@streetjs/plugin-sendgrid', '@streetjs/plugin-postgres']) {
      assert.ok(!deps[dep], `${dep} should stay install-on-demand, not bundled`);
    }
  });

  it('registers opt-in flag dependency sets with published, version-correct ranges', () => {
    const flagPackages = TEMPLATES.saas.flagPackages ?? {};
    // --with-billing → @streetjs/plugin-stripe (published 1.0.2).
    assert.deepEqual(flagPackages['with-billing'], { '@streetjs/plugin-stripe': '^1.0.2' });
    // --with-admin-ui → @streetjs/auth-ui + @streetjs/admin-ui at the ONLY
    // published major (0.1.x); the prior ^1.0.0 was unsatisfiable.
    assert.deepEqual(flagPackages['with-admin-ui'], {
      '@streetjs/auth-ui': '^0.1.2',
      '@streetjs/admin-ui': '^0.1.2',
    });
  });

  it('default saas scaffold depends ONLY on installable specs (no unpublished/unsatisfiable deps)', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { starter: 'saas' })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const pkg = JSON.parse(readFileSync(join(dir, 'proj', 'package.json'), 'utf8'));
      const deps: Record<string, string> = pkg.dependencies ?? {};
      // @streetjs/admin is not published — it must never appear by default.
      assert.ok(!deps['@streetjs/admin'], 'default scaffold must not depend on the unpublished @streetjs/admin');
      // No unsatisfiable ^1.0.0 for the UI packages (only 0.1.x is published).
      assert.ok(!deps['@streetjs/admin-ui'], 'admin-ui must be flag-gated, not a default dep');
      assert.ok(!deps['@streetjs/auth-ui'], 'auth-ui must be flag-gated, not a default dep');
      // Billing stays opt-in too.
      assert.ok(!deps['@streetjs/plugin-stripe'], 'plugin-stripe must be flag-gated, not a default dep');
      // The always-on dashboard runtime IS present and published.
      assert.equal(deps['@streetjs/plugin-htmx'], '^1.0.0', 'default scaffold depends on @streetjs/plugin-htmx');
      // No flag-gated source files leak into the default scaffold.
      assert.ok(
        !existsSync(join(dir, 'proj', 'src/modules/dashboard/auth-ui.controller.ts')),
        'auth-ui.controller.ts must not be written without --with-admin-ui',
      );
      assert.ok(
        !existsSync(join(dir, 'proj', 'src/modules/billing/billing.controller.ts')),
        'billing.controller.ts must not be written without --with-billing',
      );
      // The default starter module composes core requireRoles, not @streetjs/admin.
      const saasFeature = readFileSync(join(dir, 'proj', 'src/features/saas.ts'), 'utf8');
      assert.ok(saasFeature.includes("from 'streetjs'"), 'saas.ts imports from core streetjs');
      assert.ok(saasFeature.includes('requireRoles'), 'saas.ts composes core requireRoles');
      assert.ok(!saasFeature.includes('@streetjs/admin'), 'saas.ts must not import @streetjs/admin');
    });
  });

  it('--with-billing and --with-admin-ui add their files + correctly-versioned deps', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try {
        await new CreateCommand().execute(
          ctx(dir, ['proj'], { starter: 'saas', 'with-billing': true, 'with-admin-ui': true }),
        );
      } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const proj = join(dir, 'proj');
      // Flag-gated files are now emitted.
      assert.ok(existsSync(join(proj, 'src/modules/billing/billing.controller.ts')), 'billing controller emitted with --with-billing');
      assert.ok(existsSync(join(proj, 'src/modules/dashboard/auth-ui.controller.ts')), 'auth-ui controller emitted with --with-admin-ui');
      // Correctly-versioned, published deps are added.
      const deps = JSON.parse(readFileSync(join(proj, 'package.json'), 'utf8')).dependencies;
      assert.equal(deps['@streetjs/plugin-stripe'], '^1.0.2');
      assert.equal(deps['@streetjs/auth-ui'], '^0.1.2');
      assert.equal(deps['@streetjs/admin-ui'], '^0.1.2');
      assert.equal(deps['@streetjs/plugin-htmx'], '^1.0.0', 'always-on dashboard runtime still present');
      assert.ok(!deps['@streetjs/admin'], 'still no dependency on the unpublished @streetjs/admin');
    });
  });

  it('still registers the 001_saas.sql overlay entry with its existing tables', () => {
    assert.ok(saas001, '001_saas.sql must remain registered in extraFiles');
    for (const t of ['users', 'organizations', 'memberships', 'invitations', 'subscriptions', 'audit_logs', 'notifications']) {
      assert.ok(saas001!.content.includes(t), `001_saas.sql should still define ${t}`);
    }
  });

  it('scaffolds 001_saas.sql byte-identical to its registered template content', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { starter: 'saas' })); } finally { restore(); }
      assert.equal(process.exitCode, 0);
      const written = readFileSync(join(dir, 'proj', 'migrations', '001_saas.sql'));
      assert.equal(written.toString('utf8'), saas001!.content, '001_saas.sql written content must be byte-identical to the registered template');
    });
  });

  it('--starter saas and --template saas produce identical paths and byte-identical contents', async () => {
    await withTempDir(async (starterDir) => {
      await withTempDir(async (templateDir) => {
        const restore = capture();
        try {
          await new CreateCommand().execute(ctx(starterDir, ['proj'], { starter: 'saas' }));
          await new CreateCommand().execute(ctx(templateDir, ['proj'], { template: 'saas' }));
        } finally { restore(); }
        assert.equal(process.exitCode, 0);

        const a = snapshotDir(join(starterDir, 'proj'));
        const b = snapshotDir(join(templateDir, 'proj'));

        // Identical set of generated file paths.
        assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), 'starter and template scaffolds must generate the same file paths');

        // Byte-identical contents for every generated file.
        for (const [path, buf] of a) {
          assert.ok(b.get(path)!.equals(buf), `file ${path} must be byte-identical between --starter and --template`);
        }
      });
    });
  });

  it('an unknown starter exits 1 and writes no project files', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { starter: 'definitely-not-a-starter' })); } finally { restore(); }
      assert.equal(process.exitCode, 1);
      assert.ok(!existsSync(join(dir, 'proj')), 'no project directory should be written for an unknown starter');
      process.exitCode = 0;
    });
  });
});
