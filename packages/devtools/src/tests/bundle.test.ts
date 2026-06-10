// tests/bundle.test.ts
// Unit tests for the browser bundle renderer and data assembly
// (Req 7.1/7.2/7.3/7.4/7.5/7.6/7.7). Verifies the self-contained HTML delivers
// all four tools, reflects the route tree (method + path), embeds the dependency
// graph, disables mutating operations, and never breaks out of its script tag.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderDevtoolsBundle } from '../bundle.js';
import { buildDevtoolsData, demoDevtoolsData, type DevtoolsData } from '../data.js';
import type { StreetApp } from 'streetjs';

describe('renderDevtoolsBundle — browser experience (Req 7.6)', () => {
  const html = renderDevtoolsBundle(demoDevtoolsData());

  it('produces a complete, self-contained HTML document', () => {
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<title>Street DevTools<\/title>/);
    // Self-contained: inline script + style, no external script/stylesheet refs.
    assert.ok(!/<script[^>]+src=/.test(html), 'must not load external scripts');
    assert.ok(!/<link[^>]+stylesheet/.test(html), 'must not load external stylesheets');
  });

  it('delivers all four tools as tabs (Req 7.1/7.2/7.3/7.4)', () => {
    assert.match(html, /data-tab="playground"/);
    assert.match(html, /data-tab="routes"/);
    assert.match(html, /data-tab="graph"/);
    assert.match(html, /data-tab="inspector"/);
  });

  it('renders the route tree with method + path for each registered route (Req 7.2)', () => {
    assert.match(html, /m-GET">GET<\/span><code>\/health\/live<\/code>/);
    assert.match(html, /m-POST">POST<\/span><code>\/users<\/code>/);
    assert.match(html, /<code>\/users\/\{id\}<\/code>/);
  });

  it('embeds the dependency graph data for the visualizer (Req 7.3)', () => {
    assert.match(html, /street-devtools-data/);
    assert.match(html, /src\/main\.ts/);
    assert.match(html, /<svg id="dep-graph"/);
  });

  it('declares the token-gated, read-only model in the UI (Req 7.7)', () => {
    assert.match(html, /id="street-token"/);
    assert.match(html, /Read-only, token-gated/);
    // The inspector "Send" button is gated until a token is set.
    assert.match(html, /id="insp-run" data-needs-token disabled/);
    // The client enforces the safe-method set.
    assert.match(html, /var SAFE = \["GET","HEAD","OPTIONS"\]/);
    assert.match(html, /the devtools are read-only/);
  });

  it('does not allow the embedded JSON to break out of its script tag', () => {
    const evil: DevtoolsData = {
      title: 'X',
      baseUrl: '',
      openApi: { paths: { '/x': { get: { summary: '</script><script>alert(1)</script>' } } } },
      routeTree: [],
      depGraph: { nodes: [], edges: [] },
    };
    const out = renderDevtoolsBundle(evil);
    assert.ok(!out.includes('</script><script>alert(1)</script>'), 'raw breakout must be neutralised');
  });
});

describe('buildDevtoolsData — assembly from a live app (Req 7.2)', () => {
  it('sources the route tree from the application OpenAPI surface', () => {
    // Minimal StreetApp fake: only openApiSpec() is consumed by buildRouteTree.
    const fakeApp = {
      openApiSpec(): object {
        return {
          openapi: '3.1.0',
          info: { title: 't', version: '1' },
          paths: {
            '/a': { get: {} },
            '/a/b': { post: {} },
          },
        };
      },
    } as unknown as StreetApp;

    const data = buildDevtoolsData(fakeApp, { title: 'My App', baseUrl: 'https://x.test' });
    assert.equal(data.title, 'My App');
    assert.equal(data.baseUrl, 'https://x.test');

    // Flatten the leaves and assert both registered routes are present.
    const leaves: Array<{ method: string; path: string }> = [];
    const walk = (nodes: typeof data.routeTree): void => {
      for (const n of nodes) {
        if (n.method !== '') leaves.push({ method: n.method, path: n.path });
        if (n.children) walk(n.children);
      }
    };
    walk(data.routeTree);
    assert.ok(leaves.some((l) => l.method === 'GET' && l.path === '/a'));
    assert.ok(leaves.some((l) => l.method === 'POST' && l.path === '/a/b'));
    // No dependency entry supplied → empty graph, not a crash.
    assert.deepEqual(data.depGraph, { nodes: [], edges: [] });
  });
});
