// tests/devtools-depgraph-pbt.test.ts
// Property-based test for the Dependency Graph Visualizer data builder
// (buildDependencyGraph, Req 7.3). Kept in its own file so it does not clobber
// the example/edge-case unit tests in devtools.test.ts.
//
// Strategy: generate small synthetic module file trees — flat sets of `m{i}.ts`
// files that import one another through relative ESM specifiers (`./m{j}.js`),
// plus some bare/package imports that must be excluded — written under a unique
// temp directory inside os.tmpdir(). For each generated tree we build the graph
// and assert it is well-formed: every edge endpoint is a declared node, the
// nodes/edges are sorted (deterministic), bare/package imports are excluded,
// there are no duplicate edges, and the graph matches the import relation
// reachable from the entry module exactly (no extra, no missing edges).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import fc from 'fast-check';

import { buildDependencyGraph } from '../devx/devtools.js';

// ── Generators ────────────────────────────────────────────────────────────────
//
// A module tree is described by, for each module index `i` in `[0, n)`, the set
// of *other* module indices it imports (relative imports) and a set of bare
// specifiers it imports (which must NOT appear in the graph). The entry module
// is always `m0`, so the graph contains exactly the modules reachable from m0.

/** Bare/package specifiers that resolve outside the source dependency graph. */
const BARE_SPECIFIERS = ['node:fs', 'node:path', 'node:crypto', 'express', 'lodash', '@scope/pkg'] as const;

interface ModuleSpec {
  /** Indices of sibling modules this module imports via `./m{j}.js`. */
  imports: number[];
  /** Bare/package specifiers this module imports (must be excluded). */
  bare: string[];
}

/** A whole module tree: `spec[i]` describes module `m{i}.ts`. */
const treeArb: fc.Arbitrary<ModuleSpec[]> = fc.integer({ min: 1, max: 6 }).chain((n) => {
  const moduleArbs = Array.from({ length: n }, (_, i) => {
    const candidates = Array.from({ length: n }, (_, k) => k).filter((k) => k !== i);
    return fc.record({
      imports: fc.subarray(candidates),
      bare: fc.subarray([...BARE_SPECIFIERS]),
    });
  });
  return moduleArbs.length === 0 ? fc.constant([] as ModuleSpec[]) : fc.tuple(...moduleArbs);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Render the source for module `i` from its spec. Import style is varied to
 *  exercise side-effect imports, `import ... from`, and `export ... from`. */
function renderModule(i: number, spec: ModuleSpec): string {
  const lines: string[] = [];
  for (const t of spec.imports) {
    const style = (i + t) % 3;
    if (style === 0) lines.push(`import './m${t}.js';`);
    else if (style === 1) lines.push(`import { a${t} } from './m${t}.js';`);
    else lines.push(`export { b${t} } from './m${t}.js';`);
  }
  for (const b of spec.bare) {
    lines.push(b.startsWith('node:') ? `import '${b}';` : `import x from '${b}';`);
  }
  lines.push(`export const id = ${i};`);
  return lines.join('\n') + '\n';
}

const nodeCmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const edgeCmp = (a: [string, string], b: [string, string]): number =>
  a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;

/** Compute the expected well-formed graph independently of the implementation:
 *  BFS the relative-import relation from m0, deriving node ids the same way the
 *  builder does (paths relative to process.cwd()). */
function expectedGraph(dir: string, spec: ModuleSpec[]): { nodes: string[]; edges: Array<[string, string]> } {
  const cwd = process.cwd();
  const abs = (i: number): string => join(dir, `m${i}.ts`);
  const rel = (i: number): string => relative(cwd, abs(i)) || abs(i);

  const visited = new Set<number>([0]);
  const queue: number[] = [0];
  const edges: Array<[string, string]> = [];
  const edgeKeys = new Set<string>();

  while (queue.length > 0) {
    const cur = queue.shift() as number;
    // The builder de-duplicates resolved targets per file; mirror that.
    for (const t of [...new Set(spec[cur].imports)]) {
      const from = rel(cur);
      const to = rel(t);
      const key = `${from}\u0000${to}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        edges.push([from, to]);
      }
      if (!visited.has(t)) {
        visited.add(t);
        queue.push(t);
      }
    }
  }

  const nodes = [...visited].map(rel).sort(nodeCmp);
  edges.sort(edgeCmp);
  return { nodes, edges };
}

// ── Property ────────────────────────────────────────────────────────────────

// Feature: platform-leadership-gaps, Property 18: The dependency graph is well-formed
// Validates: Requirements 7.3
describe('Property 18: the dependency graph is well-formed', () => {
  it('every edge endpoint is a declared node; nodes/edges are sorted & deterministic; bare imports excluded; no duplicate edges; matches the import relation exactly', () => {
    fc.assert(
      fc.property(treeArb, (spec) => {
        const dir = mkdtempSync(join(tmpdir(), 'street-depgraph-'));
        try {
          // Materialize the synthetic module tree on disk.
          for (let i = 0; i < spec.length; i++) {
            writeFileSync(join(dir, `m${i}.ts`), renderModule(i, spec[i]), 'utf8');
          }

          const entry = join(dir, 'm0.ts');
          const graph = buildDependencyGraph(entry);

          const nodeSet = new Set(graph.nodes);

          // 1. Every edge endpoint is a declared node.
          for (const [from, to] of graph.edges) {
            assert.ok(nodeSet.has(from), `edge source ${from} must be a declared node`);
            assert.ok(nodeSet.has(to), `edge target ${to} must be a declared node`);
          }

          // 2. Nodes are sorted and unique (deterministic ordering).
          const sortedNodes = [...graph.nodes].sort(nodeCmp);
          assert.deepEqual(graph.nodes, sortedNodes, 'nodes must be emitted in sorted order');
          assert.equal(nodeSet.size, graph.nodes.length, 'nodes must be unique');

          // 3. Edges are sorted, with no duplicate edges.
          const sortedEdges = [...graph.edges].sort(edgeCmp);
          assert.deepEqual(graph.edges, sortedEdges, 'edges must be emitted in sorted order');
          const edgeKeys = graph.edges.map(([f, t]) => `${f}\u0000${t}`);
          assert.equal(new Set(edgeKeys).size, edgeKeys.length, 'there must be no duplicate edges');

          // 4. Bare/package imports are excluded — every node is one of our
          //    synthetic .ts modules, and no endpoint is a bare specifier.
          for (const node of graph.nodes) {
            assert.ok(node.endsWith('.ts'), `node ${node} must be a resolved source file`);
            for (const bare of BARE_SPECIFIERS) {
              assert.ok(!node.includes(bare), `bare specifier ${bare} must be excluded from nodes`);
            }
          }

          // 5. Determinism: building twice yields an identical graph.
          const again = buildDependencyGraph(entry);
          assert.deepEqual(again, graph, 'building the graph twice must be deterministic');

          // 6. The graph matches the import relation reachable from the entry
          //    exactly — every import relation is represented, nothing extra.
          const expected = expectedGraph(dir, spec);
          assert.deepEqual(graph, expected, 'graph must equal the reachable import relation exactly');
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 150 },
    );
  });
});
