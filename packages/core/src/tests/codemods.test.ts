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
