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

  // ── TypeScript resolution / bundler compatibility (regression) ──────────
  // Vite (react) and Next (next) use bundler module resolution: a local import
  // with a hardcoded `.js` extension pointing at a `.tsx`/`.ts` file fails to
  // resolve ("Module not found: Can't resolve './providers.js'"). Local imports
  // in frontend source must be extensionless.
  const LOCAL_JS_IMPORT = /from\s+['"]\.\.?\/[^'"]*\.js['"]/;

  function readFrontendSources(web: string): Array<[string, string]> {
    const files = [
      'src/main.tsx', 'src/App.tsx',           // react
      'app/layout.tsx', 'app/page.tsx', 'app/providers.tsx', // next
    ];
    const out: Array<[string, string]> = [];
    for (const f of files) {
      const p = join(web, f);
      if (existsSync(p)) out.push([f, readFileSync(p, 'utf8')]);
    }
    return out;
  }

  for (const frontend of ['react', 'next'] as const) {
    it(`${frontend} frontend has no hardcoded .js extensions on local imports`, async () => {
      await withTempDir(async (dir) => {
        const restore = capture();
        try { await new CreateCommand().execute(ctx(dir, ['proj'], { frontend })); } finally { restore(); }
        const web = join(dir, 'proj', 'web');
        const sources = readFrontendSources(web);
        assert.ok(sources.length > 0, 'frontend sources generated');
        for (const [name, content] of sources) {
          assert.ok(!LOCAL_JS_IMPORT.test(content), `${name} must not import a local module with a .js extension`);
        }
      });
    });
  }

  it('next layout imports ./providers extensionless and providers.tsx exists (App Router)', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { frontend: 'next' })); } finally { restore(); }
      const web = join(dir, 'proj', 'web');
      assert.ok(existsSync(join(web, 'app', 'providers.tsx')), 'app/providers.tsx generated');
      const layout = readFileSync(join(web, 'app', 'layout.tsx'), 'utf8');
      assert.ok(/from\s+['"]\.\/providers['"]/.test(layout), "layout imports './providers' (no .js)");
      assert.ok(!layout.includes("./providers.js"), "layout must not import './providers.js'");
      // App Router essentials: layout default export + metadata, page default export.
      const page = readFileSync(join(web, 'app', 'page.tsx'), 'utf8');
      assert.ok(/export default function/.test(layout), 'layout has a default export (App Router)');
      assert.ok(/export default function/.test(page), 'page has a default export (App Router)');
    });
  });

  it('next starter is a premium landing page, not a debug page', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { frontend: 'next' })); } finally { restore(); }
      const web = join(dir, 'proj', 'web');
      const page = readFileSync(join(web, 'app', 'page.tsx'), 'utf8');
      const layout = readFileSync(join(web, 'app', 'layout.tsx'), 'utf8');
      const css = readFileSync(join(web, 'app', 'globals.css'), 'utf8');

      // Stylesheet is generated, wired in, and supports dark mode.
      assert.ok(existsSync(join(web, 'app', 'globals.css')), 'app/globals.css generated');
      assert.ok(layout.includes("import './globals.css'"), 'layout imports the stylesheet');
      assert.ok(css.includes('prefers-color-scheme: dark'), 'stylesheet supports dark mode');

      // No debug/placeholder content.
      assert.ok(!page.includes('JSON.stringify(session'), 'does not dump raw session JSON');
      assert.ok(!/session\s*\?\?\s*null/.test(page), "no 'session ?? null' rendering");
      assert.ok(!/Session:\s*null/.test(page), "no 'Session: null' text");

      // Banned marketing phrases must not appear.
      assert.ok(!/batteries[- ]?included/i.test(page), 'no "batteries-included" phrasing');
      assert.ok(!/all-in-one backend/i.test(page), 'no "all-in-one backend" phrasing');

      // Required sections / value proposition present.
      for (const needle of [
        'Build Production Applications Faster', // hero headline
        'Quick Start',                          // quick start
        'Core Features',                        // feature grid
        'Framework Status',                     // status cards
        'Why StreetJS',                         // highlights
        'Built for Developers',                 // DX section
        'Resources',                            // resources
        'MIT Licensed',                         // footer
      ]) {
        assert.ok(page.includes(needle), `landing page includes "${needle}"`);
      }
      // Feature cards render (the six core features).
      for (const feature of ['Authentication', 'Realtime', 'Database', 'Jobs & Scheduling', 'Security', 'TypeScript First']) {
        assert.ok(page.includes(feature), `feature card "${feature}" present`);
      }
      // Dynamic version is injected (vX.Y.Z), and doc/GitHub links present.
      assert.ok(/const VERSION = 'v?\d+\.\d+\.\d+'/.test(page), 'framework version injected');
      assert.ok(page.includes('hassanmubiru.github.io/StreetJS'), 'links to documentation');
      assert.ok(page.includes('github.com/hassanmubiru/StreetJS'), 'links to GitHub');
      assert.ok(page.includes('npmjs.com/package/streetjs'), 'links to npm');
    });
  });

  it('next dev avoids the backend port and proxies health without warnings', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { frontend: 'next' })); } finally { restore(); }
      const web = join(dir, 'proj', 'web');
      const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
      const cfg = readFileSync(join(web, 'next.config.mjs'), 'utf8');

      // Dev server must not collide with the backend's default port 3000.
      assert.ok(/next dev -p (?!3000)\d+/.test(pkg.scripts.dev), 'next dev runs on a non-3000 port');
      // Health is proxied to the backend (was a 404 when missing).
      assert.ok(cfg.includes("source: '/health'"), 'next.config proxies /health to the backend');
      assert.ok(cfg.includes('/auth/:path*') && cfg.includes('/api/:path*'), 'next.config proxies api/auth');
      // Workspace root pinned so Next does not warn about multiple lockfiles.
      assert.ok(cfg.includes('turbopack') && cfg.includes('root:'), 'next.config pins turbopack.root');
    });
  });


  it('react main imports ./App extensionless (Vite resolution)', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { frontend: 'react' })); } finally { restore(); }
      const main = readFileSync(join(dir, 'proj', 'web', 'src', 'main.tsx'), 'utf8');
      assert.ok(/from\s+['"]\.\/App['"]/.test(main), "main imports './App' (no .js)");
      assert.ok(!main.includes("./App.js"), "main must not import './App.js'");
    });
  });
});
