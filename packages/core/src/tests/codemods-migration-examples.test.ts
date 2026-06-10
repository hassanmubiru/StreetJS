// tests/codemods-migration-examples.test.ts
// Runs the codemod engine against the upgrade-system MIGRATION_EXAMPLES (Req 8.8).
// Each example is a real before/after source pair for a registered codemod:
//
//   • applying the named codemod to `before` yields `after` exactly,
//   • applying it again to `after` is a byte-for-byte no-op (idempotence, Req 8.6),
//   • applying it twice from `before` still yields `after` (Req 8.6).
//
// This is the test suite the `upgrade.codemods` Verification Artifact records as
// having passed against the migration examples (Req 8.8).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyCodemods, getCodemod } from '../devx/codemods.js';
import { MIGRATION_EXAMPLES } from '../devx/migration-examples.js';

describe('codemods — migration examples (Req 8.8)', () => {
  it('ships at least one example per breaking-change area', () => {
    const areas = new Set(MIGRATION_EXAMPLES.map((e) => e.area));
    assert.ok(areas.has('routing'), 'expected a routing migration example');
    assert.ok(areas.has('middleware'), 'expected a middleware migration example');
    assert.ok(areas.has('plugin-api'), 'expected a plugin-api migration example');
  });

  it('every example references a registered codemod whose area matches', () => {
    for (const ex of MIGRATION_EXAMPLES) {
      const cm = getCodemod(ex.codemodId);
      assert.ok(cm, `example "${ex.id}" references unknown codemod "${ex.codemodId}"`);
      if (cm!.area !== undefined) {
        assert.equal(cm!.area, ex.area, `example "${ex.id}" area mismatch for codemod "${ex.codemodId}"`);
      }
    }
  });

  for (const ex of MIGRATION_EXAMPLES) {
    describe(`example ${ex.id} (${ex.codemodId})`, () => {
      it('transforms before → after exactly', () => {
        const r = applyCodemods(ex.before, [ex.codemodId]);
        assert.equal(r.skipped[ex.codemodId], undefined, `codemod unexpectedly skipped: ${r.skipped[ex.codemodId]}`);
        assert.equal(r.changed, true, 'expected the example to change');
        assert.ok(r.totalChanges >= 1, 'expected at least one change');
        assert.equal(r.code, ex.after, 'migrated source must equal the expected after-example');
      });

      it('is a byte-for-byte no-op on the already-migrated after-example (Req 8.6)', () => {
        const r = applyCodemods(ex.after, [ex.codemodId]);
        assert.equal(r.changed, false);
        assert.equal(r.totalChanges, 0);
        assert.equal(r.code, ex.after);
      });

      it('is idempotent: applying twice from before yields after (Req 8.6)', () => {
        const once = applyCodemods(ex.before, [ex.codemodId]).code;
        const twice = applyCodemods(once, [ex.codemodId]).code;
        assert.equal(once, ex.after);
        assert.equal(twice, ex.after);
      });
    });
  }
});
