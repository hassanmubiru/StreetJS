// tests/codemods-safety-pbt.test.ts
// Property-based test for codemod safe-on-failure behavior (Req 8.7). Kept in its
// own file so the universal property is exercised across many generated sources
// — including deliberately unparseable ones — without clobbering the
// example/edge-case unit tests in codemods.test.ts.
//
// Safe-on-failure contract (Req 8.7): IF a codemod cannot complete a
// transformation because the source cannot be parsed, or because the change
// would conflict, THEN it leaves the source byte-for-byte unchanged and reports
// the reason instead of emitting a partial/garbled edit. Concretely, whenever a
// `CodemodResult.skipped` reason is present:
//   • `code` equals the original input byte-for-byte,
//   • `changed` is false and `changes` is 0,
//   • the reported reason is a non-empty string.
// And the two failure modes are reliably *detected*: any unparseable source is
// skipped with a "cannot parse" reason, and any source carrying both the old and
// new identifiers is skipped with a "conflict" reason.
//
// Code under test: ALL_CODEMODS (every registered codemod), the registered
// safe-rename area codemods (via getCodemod), the safeRenameCodemod factory, and
// applyCodemods (the orchestrated set, which surfaces skip reasons).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  ALL_CODEMODS,
  applyCodemods,
  getCodemod,
  safeRenameCodemod,
  type Codemod,
} from '../devx/codemods.js';

const NUM_RUNS = 200;

// ── Generators ────────────────────────────────────────────────────────────────
//
// Intelligently constrain to the source-string input space the codemods care
// about, and — crucially for Req 8.7 — guarantee coverage of the two failure
// modes: unparseable sources and conflicting sources.

/** The registered safe-rename area codemods, paired with the identifiers they
 *  rename FROM/TO. Aligned with ROUTING/MIDDLEWARE/PLUGIN_API_CODEMODS. */
const SAFE_RENAMES = [
  { id: 'rename-router-context', from: 'RouterContext', to: 'RouteContext' },
  { id: 'rename-route-handler-type', from: 'RouteHandlerFn', to: 'RouteHandler' },
  { id: 'rename-middleware-next', from: 'MiddlewareNext', to: 'NextFunction' },
  { id: 'rename-use-middleware', from: 'useMiddleware', to: 'use' },
  { id: 'rename-plugin-register', from: 'registerPlugin', to: 'usePlugin' },
  { id: 'rename-plugin-context', from: 'PluginContext', to: 'PluginHost' },
] as const;

const FROM_TOKENS = SAFE_RENAMES.map((r) => r.from);
const TO_TOKENS = SAFE_RENAMES.map((r) => r.to);

/** Bracket-free, quote-free, comment-free filler. A source built only from these
 *  (plus identifier tokens) has NO parse obstruction, so we can inject exactly
 *  one obstruction to make it deterministically unparseable. */
const SAFE_FILLER = [
  'const', 'let', 'function', 'type', 'import', 'from', 'return', 'new',
  'app', 'ctx', 'x', 'y', 'foo', 'Bar2',
  ';', '=', ':', '.', ',', ' ',
] as const;

/** Tokens that, appended to an otherwise-balanced source, deterministically
 *  introduce a parse obstruction recognised by the codemod guard. */
const OBSTRUCTIONS = [
  '(', '[', '{', // unclosed grouping
  '"', "'",      // unterminated string literal
  '`',           // unterminated template literal
  '/*',          // unterminated block comment
] as const;

const safeFillerToken = fc.constantFrom(...SAFE_FILLER);
const relevantToken = fc.constantFrom(...FROM_TOKENS, ...TO_TOKENS, ...SAFE_FILLER);

/** A well-formed (parseable) source mixing identifiers with bracket-free filler. */
const wellFormedSourceArb: fc.Arbitrary<string> = fc
  .array(relevantToken, { minLength: 0, maxLength: 40 })
  .map((parts) => parts.join(' '));

/** A deterministically UNPARSEABLE source: bracket-free filler (plus an optional
 *  pre-migration token so the rename is relevant) followed by exactly one
 *  injected obstruction at the end, where nothing can close it. */
const unparseableSourceArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(safeFillerToken, { minLength: 0, maxLength: 20 }),
    fc.option(fc.constantFrom(...FROM_TOKENS), { nil: undefined }),
    fc.constantFrom(...OBSTRUCTIONS),
  )
  .map(([filler, fromTok, obstruction]) => {
    const head = fromTok ? [fromTok, ...filler] : filler;
    return `${head.join(' ')} ${obstruction}`;
  });

/** Any source: well-formed, deterministically unparseable, or arbitrary text. */
const anySourceArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 4, arbitrary: wellFormedSourceArb },
  { weight: 4, arbitrary: unparseableSourceArb },
  { weight: 1, arbitrary: fc.string() },
);

/** Any single registered codemod. */
const codemodArb: fc.Arbitrary<Codemod> = fc.constantFrom(...ALL_CODEMODS);

/** A registered safe-rename codemod paired with its from/to identifiers. */
const safeRenameArb = fc.constantFrom(...SAFE_RENAMES);

/** Two distinct identifier names for an ad-hoc safeRenameCodemod. */
const NAME_POOL = ['Alpha', 'Beta', 'Gamma', 'Delta', 'doThing', 'oldName', 'newName', 'Widget'] as const;
const namePairArb: fc.Arbitrary<[string, string]> = fc
  .tuple(fc.constantFrom(...NAME_POOL), fc.constantFrom(...NAME_POOL))
  .filter(([a, b]) => a !== b);

/** Assert the safe-on-failure invariant for a single codemod result. */
function assertSafeOnFailure(src: string, r: ReturnType<Codemod['apply']>, label: string): void {
  if (!r.skipped) return; // invariant only constrains the skipped branch
  assert.equal(r.code, src, `${label}: skipped result must leave source byte-for-byte unchanged`);
  assert.equal(r.changed, false, `${label}: skipped result must report changed=false`);
  assert.equal(r.changes, 0, `${label}: skipped result must report changes=0`);
  assert.equal(typeof r.skipped.reason, 'string');
  assert.ok(r.skipped.reason.length > 0, `${label}: skipped result must report a non-empty reason`);
}

// Feature: platform-leadership-gaps, Property 23: Codemods are safe on failure
// Validates: Requirements 8.7
describe('Property 23: codemods are safe on failure', () => {
  // Core invariant: whenever ANY registered codemod declines to transform ANY
  // source (parseable, unparseable, or arbitrary text), the source is returned
  // byte-for-byte unchanged with a non-empty reason and zero changes.
  it('a skipped result leaves the source unchanged and reports a reason, for every codemod', () => {
    fc.assert(
      fc.property(codemodArb, anySourceArb, (codemod, src) => {
        assertSafeOnFailure(src, codemod.apply(src), `codemod "${codemod.id}"`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Unparseable sources are reliably detected: a safe-rename codemod skips them
  // with a "cannot parse" reason and emits no edit (no partial/garbled output).
  it('detects unparseable sources, leaves them unchanged, and reports the parse failure', () => {
    fc.assert(
      fc.property(safeRenameArb, unparseableSourceArb, ({ id }, src) => {
        const cm = getCodemod(id)!;
        const r = cm.apply(src);
        assert.ok(r.skipped, `codemod "${id}" must skip unparseable source: ${JSON.stringify(src)}`);
        assert.match(r.skipped!.reason, /cannot parse/);
        assert.equal(r.code, src, `codemod "${id}" must leave unparseable source byte-for-byte unchanged`);
        assert.equal(r.changed, false);
        assert.equal(r.changes, 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Conflicting sources are reliably detected: when both the old and new
  // identifiers are present as standalone tokens, the rename would merge two
  // symbols, so the codemod skips with a "conflict" reason and leaves it intact.
  it('detects conflicts, leaves the source unchanged, and reports the conflict', () => {
    fc.assert(
      fc.property(
        safeRenameArb,
        fc.array(safeFillerToken, { minLength: 0, maxLength: 20 }),
        ({ id, from, to }, filler) => {
          // Bracket/quote-free source containing BOTH identifiers → guaranteed
          // parseable AND conflicting.
          const src = [from, ...filler, to].join(' ');
          const r = getCodemod(id)!.apply(src);
          assert.ok(r.skipped, `codemod "${id}" must skip conflicting source: ${JSON.stringify(src)}`);
          assert.match(r.skipped!.reason, /conflict/);
          assert.equal(r.code, src, `codemod "${id}" must leave conflicting source byte-for-byte unchanged`);
          assert.equal(r.changed, false);
          assert.equal(r.changes, 0);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // The factory itself produces safe-on-failure codemods for arbitrary name
  // pairs, not just the built-in renames.
  it('safeRenameCodemod is safe on failure for arbitrary name pairs', () => {
    fc.assert(
      fc.property(namePairArb, anySourceArb, ([from, to], src) => {
        const cm = safeRenameCodemod('pbt-safe', from, to, 'routing', 'pbt');
        assertSafeOnFailure(src, cm.apply(src), `safeRenameCodemod ${from}->${to}`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // The orchestrated path surfaces the skip reason AND carries the source
  // forward unchanged: a skipped codemod contributes zero changes and never
  // mutates the running source (Req 8.7 at the applyCodemods level).
  it('applyCodemods surfaces skip reasons and carries an unparseable source forward unchanged', () => {
    fc.assert(
      fc.property(safeRenameArb, unparseableSourceArb, ({ id }, src) => {
        const r = applyCodemods(src, [id]);
        assert.equal(r.code, src, `applyCodemods([${id}]) must carry unparseable source forward unchanged`);
        assert.equal(r.changed, false);
        assert.equal(r.totalChanges, 0);
        assert.match(r.skipped[id], /cannot parse/);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
