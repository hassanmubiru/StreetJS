// tests/devtools.test.ts
// Unit tests for the Interactive Developer Experience data builders
// (Req 7.2 route tree, 7.3 dependency graph, 7.4/7.5 API Inspector model).
// These cover concrete examples and edge cases; the universal properties are
// exercised by the dedicated property-based tests.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assembleRouteTree, flattenRouteTree, buildRouteTree,
  buildDependencyGraph, inspectorSuccess, inspectorFailure,
  type RouteNode,
} from '../devx/devtools.js';

// ── Route Explorer (Req 7.2) ──────────────────────────────────────────────────

describe('buildRouteTree / assembleRouteTree (Req 7.2)', () => {
  it('produces a tree whose leaves reflect exactly the registered routes', () => {
    const routes = [
      { method: 'GET', path: '/users' },
      { method: 'POST', path: '/users' },
      { method: 'GET', path: '/users/:id' },
      { method: 'GET', path: '/' },
    ];
    const tree = assembleRouteTree(routes);
    const flat = flattenRouteTree(tree);

    const norm = (r: { method: string; path: string }): string => `${r.method} ${r.path}`;
    assert.deepEqual(
      flat.map(norm).sort(),
      routes.map(norm).sort(),
    );
  });

  it('each leaf carries an HTTP method and the full path', () => {
    const tree = assembleRouteTree([{ method: 'get', path: '/health/live' }]);
    const leaves = flattenRouteTree(tree);
    assert.equal(leaves.length, 1);
    assert.equal(leaves[0]!.method, 'GET'); // method is upper-cased
    assert.equal(leaves[0]!.path, '/health/live');
  });

  it('de-duplicates identical method+path pairs', () => {
    const tree = assembleRouteTree([
      { method: 'GET', path: '/a' },
      { method: 'GET', path: '/a' },
    ]);
    assert.equal(flattenRouteTree(tree).length, 1);
  });

  it('shares structural nodes for a common path prefix', () => {
    const tree = assembleRouteTree([
      { method: 'GET', path: '/users/:id' },
      { method: 'GET', path: '/users/:id/posts' },
    ]);
    // Top level should have a single "/users" group, not two.
    const groups = tree.filter((n: RouteNode) => n.method === '');
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.path, '/users');
  });

  it('is deterministic for the same registered routes', () => {
    const routes = [
      { method: 'POST', path: '/b' },
      { method: 'GET', path: '/a' },
      { method: 'GET', path: '/b' },
    ];
    assert.deepEqual(assembleRouteTree(routes), assembleRouteTree([...routes].reverse()));
  });

  it('reads routes from a real StreetApp OpenAPI surface', async () => {
    const { streetApp } = await import('../http/server.js');
    const { Controller, Get, Post } = await import('../core/decorators.js');
    const { container } = await import('../core/container.js');

    @Controller('/widgets')
    class WidgetCtrl {
      @Get('/')
      async list(): Promise<void> { /* noop */ }
      @Post('/')
      async create(): Promise<void> { /* noop */ }
      @Get('/:id')
      async get(): Promise<void> { /* noop */ }
    }

    container.reset();
    const app = streetApp({});
    app.registerController(WidgetCtrl);

    const flat = flattenRouteTree(buildRouteTree(app)).map((r) => `${r.method} ${r.path}`).sort();
    assert.deepEqual(flat, ['GET /widgets', 'GET /widgets/:id', 'POST /widgets'].sort());
  });
});

// ── Dependency Graph Visualizer (Req 7.3) ─────────────────────────────────────

describe('buildDependencyGraph (Req 7.3)', () => {
  it('walks relative imports into a well-formed node/edge graph', () => {
    const dir = mkdtempSync(join(tmpdir(), 'street-depgraph-'));
    try {
      mkdirSync(join(dir, 'sub'), { recursive: true });
      writeFileSync(join(dir, 'entry.ts'), "import { a } from './a.js';\nexport { b } from './sub/b.js';\nimport 'node:fs';\n");
      writeFileSync(join(dir, 'a.ts'), "export const a = 1;\n");
      writeFileSync(join(dir, 'sub', 'b.ts'), "import { a } from '../a.js';\nexport const b = a;\n");

      const graph = buildDependencyGraph(join(dir, 'entry.ts'));

      // 3 source files reachable (entry, a, sub/b); node:fs is excluded.
      assert.equal(graph.nodes.length, 3);
      // Every edge endpoint is a declared node.
      for (const [from, to] of graph.edges) {
        assert.ok(graph.nodes.includes(from), `missing node ${from}`);
        assert.ok(graph.nodes.includes(to), `missing node ${to}`);
      }
      // entry → a, entry → sub/b, sub/b → a  (3 edges)
      assert.equal(graph.edges.length, 3);
      // Bare/package imports are not part of the graph.
      assert.ok(!graph.nodes.some((n) => n.includes('node:')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty graph for a non-existent entry', () => {
    const graph = buildDependencyGraph(join(tmpdir(), 'does-not-exist-xyz.ts'));
    assert.deepEqual(graph, { nodes: [], edges: [] });
  });

  it('is deterministic (sorted nodes and edges)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'street-depgraph2-'));
    try {
      writeFileSync(join(dir, 'entry.ts'), "import './z.js';\nimport './a.js';\n");
      writeFileSync(join(dir, 'z.ts'), 'export const z = 1;\n');
      writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
      const g1 = buildDependencyGraph(join(dir, 'entry.ts'));
      const g2 = buildDependencyGraph(join(dir, 'entry.ts'));
      assert.deepEqual(g1, g2);
      assert.deepEqual([...g1.nodes].sort(), g1.nodes);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── API Inspector model (Req 7.4 / 7.5) ───────────────────────────────────────

describe('InspectorResult (Req 7.4 / 7.5)', () => {
  const request = { method: 'POST', url: '/api/echo', headers: { 'x-test': '1' }, body: '{"hello":"world"}' };

  it('captures status, headers, and body on success (Req 7.4)', () => {
    const result = inspectorSuccess(request, { status: 201, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
    assert.deepEqual(result.headers, { 'content-type': 'application/json' });
    assert.equal(result.body, '{"ok":true}');
    assert.deepEqual(result.request, request);
  });

  it('records an error and retains the submitted input on failure (Req 7.5)', () => {
    const result = inspectorFailure(request, new Error('ECONNREFUSED'));
    assert.equal(result.ok, false);
    assert.equal(result.error, 'ECONNREFUSED');
    // The submitted request is retained verbatim.
    assert.deepEqual(result.request, request);
  });

  it('coerces non-Error failures to a message and still retains input', () => {
    const result = inspectorFailure(request, 'boom');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'boom');
    assert.deepEqual(result.request, request);
  });
});
