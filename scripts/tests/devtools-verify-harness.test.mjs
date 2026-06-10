// scripts/tests/devtools-verify-harness.test.mjs
//
// Unit tests for the Interactive Developer Experience (devtools) Layer-B
// verification harness (Requirement 7.9). These exercise the harness's pure,
// browser-free logic:
//
//   • the headless-browser prerequisite probe returns either `null` (a usable
//     browser) or a well-formed BlockedReason `{ missingPrerequisite, kind }` —
//     exactly the shape the runner needs to record an honest BLOCKED.
//   • the per-tool DOM assertions accept a correctly rendered post-JS DOM and
//     reject DOMs missing the client-rendered content or the JS-executed
//     sentinel, so a regression in the bundle would be caught.
//   • the three capability ids map to the three tools.
//
// The full headless round trip (build → test → real browser render) is Layer B
// and is covered by the devx.* Verification Artifacts produced through
// CommandRunner; it is intentionally NOT run here so the unit suite stays green
// without a browser.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  probeHeadlessBrowser,
  resolveBrowserBinary,
  assertTool,
  DEVTOOLS_TOOLS,
} from '../devtools/lib.mjs';

// A minimal post-JS DOM fragment that satisfies every tool's assertions: it
// carries the JS-executed sentinel (the init script populated #token-status),
// the route tree leaf, the dependency-graph SVG + summary, and a Playground op
// with a populated OpenAPI viewer.
const GOOD_DOM = `
<span id="token-status" class="warn">No token set — requests are blocked until a token is entered.</span>
<ul class="routes"><li><span class="m m-GET">GET</span><code>/health/live</code></li></ul>
<svg id="dep-graph"><circle cx="1" cy="1" r="6"></circle></svg>
<p id="dep-count">4 modules, 3 edges</p>
<div class="op"><span class="m m-GET">GET</span><code>/users</code></div>
<pre id="openapi-viewer">{ "openapi": "3.1.0" }</pre>
`;

describe('devtools Layer-B harness — prerequisite probe', () => {
  it('returns null or a well-formed headless-browser BlockedReason', () => {
    const result = probeHeadlessBrowser();
    if (result === null) {
      // A usable headless browser is present in this environment.
      assert.ok(resolveBrowserBinary(), 'a null probe implies a resolvable browser binary');
      return;
    }
    assert.equal(result.missingPrerequisite, 'headless-browser');
    assert.equal(result.kind, 'runtime');
  });
});

describe('devtools Layer-B harness — per-tool DOM assertions', () => {
  for (const { tool } of DEVTOOLS_TOOLS) {
    it(`accepts a correctly rendered post-JS DOM for ${tool}`, () => {
      assert.deepEqual(assertTool(tool, GOOD_DOM), [], `${tool} should have no failures on a good DOM`);
    });
  }

  it('rejects a DOM where the client JS did not execute (no sentinel)', () => {
    const noJs = GOOD_DOM.replace('class="warn">No token set', 'class="warn">');
    for (const { tool } of DEVTOOLS_TOOLS) {
      const failures = assertTool(tool, noJs);
      assert.ok(
        failures.some((f) => /client JS did not execute/.test(f)),
        `${tool} must flag missing JS execution`,
      );
    }
  });

  it('rejects a route-explorer DOM missing the route tree', () => {
    const noRoutes = GOOD_DOM.replace('class="routes"', 'class="other"').replace(
      'm-GET">GET</span><code>/health/live</code>',
      '',
    );
    const failures = assertTool('route-explorer', noRoutes);
    assert.ok(failures.length > 0, 'a missing route tree must be flagged');
  });

  it('rejects a dependency-graph DOM with no drawn nodes', () => {
    const noGraph = GOOD_DOM.replace('<circle cx="1" cy="1" r="6"></circle>', '').replace(
      '4 modules, 3 edges',
      '',
    );
    const failures = assertTool('dependency-graph', noGraph);
    assert.ok(failures.length >= 2, 'missing nodes + summary must be flagged');
  });

  it('rejects a playground DOM with no operations or empty viewer', () => {
    const noOps = GOOD_DOM.replace('<div class="op">', '<div class="not-op">').replace(
      '<pre id="openapi-viewer">{ "openapi": "3.1.0" }</pre>',
      '<pre id="openapi-viewer"></pre>',
    );
    const failures = assertTool('playground', noOps);
    assert.ok(failures.length >= 2, 'missing ops + empty viewer must be flagged');
  });

  it('flags an unknown tool', () => {
    const failures = assertTool('not-a-tool', GOOD_DOM);
    assert.ok(failures.some((f) => /unknown tool/.test(f)));
  });
});

describe('devtools Layer-B harness — capability mapping', () => {
  it('maps the three tools to the three devx.* capability ids', () => {
    const ids = DEVTOOLS_TOOLS.map((t) => t.capabilityId).sort();
    assert.deepEqual(ids, ['devx.dependency-graph', 'devx.playground', 'devx.route-explorer']);
  });
});
