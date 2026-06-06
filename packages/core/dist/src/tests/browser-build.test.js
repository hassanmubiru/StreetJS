// tests/browser-build.test.ts
// Browser export-condition compatibility tests.
//
// These verify that the package.json "browser" export condition produces a
// bundle that is free of Node.js core modules, using esbuild (a real bundler)
// with platform: 'browser' so the browser condition is selected. We also assert
// the static shape of the browser entry and that Node-only subpaths resolve to
// the throwing stub.
//
// esbuild's resolver honours the "browser" condition the same way Vite, Rollup
// (@rollup/plugin-node-resolve) and Webpack 5 do, so a clean esbuild browser
// build is a strong signal of cross-bundler compatibility.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const NODE_BUILTINS = [
    'node:net', 'node:fs', 'node:tls', 'node:http', 'node:https', 'node:crypto',
    'node:dns', 'node:cluster', 'node:child_process', 'node:worker_threads',
    'node:zlib', 'node:stream', 'node:os', 'node:dgram',
];
// Resolve the on-disk browser entry from this compiled test's location:
// dist/src/tests/browser-build.test.js → ../../browser.js
const here = fileURLToPath(import.meta.url);
const distRoot = join(here, '..', '..', '..'); // → packages/core/dist
const browserEntry = join(distRoot, 'browser.js');
const browserStub = join(distRoot, 'browser-stub.js');
function tmpFile(contents, name) {
    const dir = mkdtempSync(join(tmpdir(), 'street-browser-'));
    const file = join(dir, name);
    writeFileSync(file, contents, 'utf8');
    return { dir, file };
}
describe('browser export conditions', () => {
    it('bundles the browser entry for platform=browser with no Node built-ins', async () => {
        const { dir, file } = tmpFile(`import { LruCache, sanitizeString, NotFoundException, STREET_BUILD_TARGET } from ${JSON.stringify(browserEntry)};
       const c = new LruCache({ maxSize: 4 });
       c.set('k', sanitizeString('<b>x</b>'));
       export const out = { v: c.get('k'), t: STREET_BUILD_TARGET, e: new NotFoundException('x').status };`, 'entry.mjs');
        try {
            const result = await build({
                entryPoints: [file],
                bundle: true,
                write: false,
                format: 'esm',
                platform: 'browser',
                conditions: ['browser'],
                logLevel: 'silent',
            });
            const code = result.outputFiles[0].text;
            for (const mod of NODE_BUILTINS) {
                assert.ok(!code.includes(`require("${mod}")`), `bundle must not require ${mod}`);
                assert.ok(!code.includes(`from"${mod}"`), `bundle must not import ${mod}`);
            }
            assert.ok(code.includes('browser'), 'build target marker present');
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    it('marks Node built-ins external and still bundles cleanly (no unresolved imports)', async () => {
        const { dir, file } = tmpFile(`export * from ${JSON.stringify(browserEntry)};`, 'reexport.mjs');
        try {
            const result = await build({
                entryPoints: [file],
                bundle: true,
                write: false,
                format: 'esm',
                platform: 'browser',
                conditions: ['browser'],
                // If the browser entry transitively pulled in a node: builtin, marking
                // them external would hide it — so here we DON'T mark them external and
                // require the build to succeed, proving the graph is node-free.
                logLevel: 'silent',
            });
            assert.equal(result.errors.length, 0, 'no bundler errors');
            assert.ok(result.outputFiles.length > 0, 'produced output');
        }
        finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
    it('the browser entry exposes the runtime-agnostic public API', async () => {
        const mod = await import(browserEntry);
        assert.equal(typeof mod.LruCache, 'function');
        assert.equal(typeof mod.sanitizeString, 'function');
        assert.equal(typeof mod.escapeHtml, 'function');
        assert.equal(typeof mod.NotFoundException, 'function');
        assert.equal(typeof mod.FeatureUnavailableInEdgeRuntimeError, 'function');
        assert.equal(mod.STREET_BUILD_TARGET, 'browser');
    });
    it('the Node-only browser stub throws FeatureUnavailableInEdgeRuntimeError on use', async () => {
        const stub = await import(browserStub);
        const { FeatureUnavailableInEdgeRuntimeError } = await import(join(distRoot, 'http', 'exceptions.js'));
        assert.throws(() => stub.default.anything, (e) => e instanceof FeatureUnavailableInEdgeRuntimeError);
        assert.throws(() => stub.default(), (e) => e instanceof FeatureUnavailableInEdgeRuntimeError);
        assert.equal(stub.__browserStub, true);
    });
    it('the browser entry source contains no node: imports (static guarantee)', async () => {
        const { readFileSync } = await import('node:fs');
        const code = readFileSync(browserEntry, 'utf8');
        assert.ok(!/from\s+["']node:/.test(code), 'browser.js must not import node: builtins');
        assert.ok(!/require\(["']node:/.test(code), 'browser.js must not require node: builtins');
    });
});
//# sourceMappingURL=browser-build.test.js.map