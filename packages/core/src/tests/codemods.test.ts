// tests/codemods.test.ts
// Verifies the codemod engine that powers `street upgrade`: identifier renaming
// with word boundaries, change counting, the built-in RabbitMQ rename, codemod
// selection, and unknown-id rejection.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCodemods, listCodemods, getCodemod, renameIdentifierCodemod, BUILTIN_CODEMODS,
} from '../devx/codemods.js';

describe('codemods — identifier rename', () => {
  const cm = renameIdentifierCodemod('t', 'Foo', 'Bar', 'test');
  it('renames whole-word occurrences and counts them', () => {
    const r = cm.apply('const x = new Foo(); Foo.y; let Foo2 = 1;');
    assert.equal(r.changes, 2);          // Foo and Foo.y, NOT Foo2
    assert.equal(r.changed, true);
    assert.match(r.code, /new Bar\(\)/);
    assert.match(r.code, /Bar\.y/);
    assert.match(r.code, /Foo2/);        // partial match untouched
  });
  it('reports no change when the identifier is absent', () => {
    const r = cm.apply('const x = 1;');
    assert.equal(r.changes, 0);
    assert.equal(r.changed, false);
  });
});

describe('codemods — built-in RabbitMQ rename', () => {
  it('rewrites the deprecated RabbitMQTransport alias', () => {
    const src = "import { RabbitMQTransport } from '@streetjs/core';\nconst t = new RabbitMQTransport({ host: 'h' });";
    const r = applyCodemods(src, ['rename-rabbitmq-transport']);
    assert.equal(r.totalChanges, 2);
    assert.match(r.code, /import \{ RabbitMqTransport \}/);
    assert.match(r.code, /new RabbitMqTransport\(/);
    assert.equal(r.perCodemod['rename-rabbitmq-transport'], 2);
  });
  it('is registered as a built-in and discoverable', () => {
    assert.ok(getCodemod('rename-rabbitmq-transport'));
    assert.ok(listCodemods().some((c) => c.id === 'rename-rabbitmq-transport'));
    assert.ok(BUILTIN_CODEMODS.length >= 1);
  });
});

describe('codemods — apply orchestration', () => {
  it('runs all built-ins by default and tallies changes', () => {
    const r = applyCodemods('new RabbitMQTransport();');
    assert.equal(r.changed, true);
    assert.ok(r.totalChanges >= 1);
  });
  it('leaves already-migrated code unchanged', () => {
    const r = applyCodemods('new RabbitMqTransport();');
    assert.equal(r.changed, false);
    assert.equal(r.totalChanges, 0);
  });
  it('throws on an unknown codemod id', () => {
    assert.throws(() => applyCodemods('x', ['does-not-exist']), /Unknown codemod/);
  });
});

// ── Area migration codemods (routing / middleware / plugin-API) — Req 8.5/8.6/8.7 ──

import {
  ROUTING_CODEMODS, MIDDLEWARE_CODEMODS, PLUGIN_API_CODEMODS, ALL_CODEMODS, safeRenameCodemod,
} from '../devx/codemods.js';

describe('codemods — area migrations are registered and discoverable', () => {
  it('exposes routing, middleware, and plugin-API codemods', () => {
    assert.ok(ROUTING_CODEMODS.length >= 1);
    assert.ok(MIDDLEWARE_CODEMODS.length >= 1);
    assert.ok(PLUGIN_API_CODEMODS.length >= 1);
  });
  it('tags each area codemod with its area and registers it in ALL_CODEMODS', () => {
    for (const c of ROUTING_CODEMODS) assert.equal(c.area, 'routing');
    for (const c of MIDDLEWARE_CODEMODS) assert.equal(c.area, 'middleware');
    for (const c of PLUGIN_API_CODEMODS) assert.equal(c.area, 'plugin-api');
    for (const c of [...ROUTING_CODEMODS, ...MIDDLEWARE_CODEMODS, ...PLUGIN_API_CODEMODS]) {
      assert.ok(getCodemod(c.id), `getCodemod should resolve ${c.id}`);
      assert.ok(listCodemods().some((l) => l.id === c.id));
    }
  });
  it('keeps the built-in rabbitmq codemod intact', () => {
    assert.ok(getCodemod('rename-rabbitmq-transport'));
    assert.ok(ALL_CODEMODS.some((c) => c.id === 'rename-rabbitmq-transport'));
  });
});

describe('codemods — safe rename behavior', () => {
  const cm = getCodemod('rename-router-context')!;

  it('renames whole-word occurrences in a routing migration', () => {
    const r = cm.apply('function h(ctx: RouterContext) { return ctx; }');
    assert.equal(r.changes, 1);
    assert.equal(r.changed, true);
    assert.match(r.code, /RouteContext/);
    assert.ok(!r.skipped);
  });

  it('is a clean no-op on already-migrated source', () => {
    const src = 'function h(ctx: RouteContext) { return ctx; }';
    const r = cm.apply(src);
    assert.equal(r.changed, false);
    assert.equal(r.changes, 0);
    assert.equal(r.code, src);
    assert.ok(!r.skipped);
  });

  it('is idempotent: apply(apply(x)) === apply(x)', () => {
    const src = 'const a: RouterContext = x; let b: RouterContext;';
    const once = cm.apply(src).code;
    const twice = cm.apply(once).code;
    assert.equal(twice, once);
  });

  it('leaves the file unchanged and reports a reason on conflict (Req 8.7)', () => {
    // Both old and new identifiers present → renaming would merge two symbols.
    const src = 'type RouteContext = {}; function h(c: RouterContext) {}';
    const r = cm.apply(src);
    assert.equal(r.changed, false);
    assert.equal(r.changes, 0);
    assert.equal(r.code, src);
    assert.match(r.skipped!.reason, /conflict/);
  });

  it('leaves the file unchanged and reports a reason on unparseable source (Req 8.7)', () => {
    const src = 'function h(ctx: RouterContext) { return ctx;'; // missing closing brace
    const r = cm.apply(src);
    assert.equal(r.changed, false);
    assert.equal(r.code, src);
    assert.match(r.skipped!.reason, /cannot parse/);
  });

  it('does not miscount brackets inside strings, templates, or comments', () => {
    const src = [
      'function h(c: RouterContext) {',
      '  const s = "a { b ( c [ d";',
      '  const t = `x ${ y } { z`;',
      '  /* } ) ] */',
      '  return c;',
      '}',
    ].join('\n');
    const r = cm.apply(src);
    assert.ok(!r.skipped, `should be parseable, got: ${r.skipped?.reason}`);
    assert.equal(r.changes, 1);
  });
});

describe('codemods — applyCodemods surfaces skip reasons', () => {
  it('records the reason and carries the source forward unchanged', () => {
    const src = 'function h(c: RouterContext) {'; // unbalanced
    const r = applyCodemods(src, ['rename-router-context']);
    assert.equal(r.changed, false);
    assert.equal(r.totalChanges, 0);
    assert.equal(r.code, src);
    assert.match(r.skipped['rename-router-context'], /cannot parse/);
  });

  it('applies a selected middleware codemod by id', () => {
    const r = applyCodemods('app.useMiddleware(logger);', ['rename-use-middleware']);
    assert.equal(r.totalChanges, 1);
    assert.match(r.code, /app\.use\(logger\)/);
  });
});

describe('codemods — safeRenameCodemod factory', () => {
  it('builds a codemod that guards parse + conflict', () => {
    const cm = safeRenameCodemod('t-safe', 'Old', 'New', 'routing', 'test');
    assert.equal(cm.area, 'routing');
    assert.equal(cm.apply('const x: Old = 1;').code, 'const x: New = 1;');
    assert.match(cm.apply('Old; New;').skipped!.reason, /conflict/);
    assert.match(cm.apply('Old(').skipped!.reason, /cannot parse/);
  });
});
