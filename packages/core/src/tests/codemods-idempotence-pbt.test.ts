// tests/codemods-idempotence-pbt.test.ts
// Property-based test for codemod idempotence (Req 8.6). Kept in its own file so
// the universal property is exercised across many generated (source, codemod)
// pairs without clobbering the example/edge-case unit tests in codemods.test.ts.
//
// Every codemod is a pure source→source transform. The idempotence contract
// (Req 8.6) states: applying a codemod a second time to its own output yields
// byte-for-byte identical text — apply(apply(x)) === apply(x). This holds for
// every outcome:
//   • a successful whole-word rename leaves no `from` tokens, so the re-run is a
//     zero-change no-op;
//   • an already-migrated / token-absent source is a clean no-op on the first
//     pass already;
//   • an unparseable or conflicting source is left unchanged (Req 8.7), so the
//     re-run sees the same input.
//
// Code under test: ALL_CODEMODS (every registered codemod), applyCodemods (the
// orchestrated set), and the safeRenameCodemod factory (over generated names).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  ALL_CODEMODS,
  applyCodemods,
  safeRenameCodemod,
  type Codemod,
} from '../devx/codemods.js';

const NUM_RUNS = 200;

// ── Generators ────────────────────────────────────────────────────────────────
//
// Intelligently constrain to the source-string input space the codemods care
// about: the old/new identifier tokens of every registered rename, plus filler
// that produces realistic, sometimes-unparseable code.

/** Every identifier a registered codemod renames FROM (pre-migration tokens). */
const FROM_TOKENS = [
  'RabbitMQTransport',
  'RouterContext',
  'RouteHandlerFn',
  'MiddlewareNext',
  'useMiddleware',
  'registerPlugin',
  'PluginContext',
] as const;

/** Every identifier a registered codemod renames TO (already-migrated tokens). */
const TO_TOKENS = [
  'RabbitMqTransport',
  'RouteContext',
  'RouteHandler',
  'NextFunction',
  'use',
  'usePlugin',
  'PluginHost',
] as const;

/** Structural filler: keywords, separators, and brackets. Brackets are included
 *  deliberately so some generated sources are unbalanced/unparseable, exercising
 *  the safe-on-failure no-op path (which is trivially idempotent). */
const FILLER = [
  'const', 'let', 'function', 'type', 'import', 'from', 'return', 'new',
  'app', 'ctx', 'x', 'y', 'foo', 'Bar2',
  ';', '=', ':', '.', ',', '(', ')', '{', '}', '[', ']',
  ' ', '\n', '\t',
] as const;

const relevantToken = fc.constantFrom(...FROM_TOKENS, ...TO_TOKENS, ...FILLER);
const migratedToken = fc.constantFrom(...TO_TOKENS, ...FILLER);

/** A source string mixing pre- and post-migration tokens with filler. */
const mixedSourceArb: fc.Arbitrary<string> = fc
  .array(relevantToken, { minLength: 0, maxLength: 40 })
  .map((parts) => parts.join(' '));

/** A source string built ONLY from already-migrated tokens + filler, so the
 *  codemods should be a clean no-op on the very first pass. */
const migratedSourceArb: fc.Arbitrary<string> = fc
  .array(migratedToken, { minLength: 0, maxLength: 40 })
  .map((parts) => parts.join(' '));

/** Any source string: structured (mixed), already-migrated, or arbitrary text. */
const sourceArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 5, arbitrary: mixedSourceArb },
  { weight: 3, arbitrary: migratedSourceArb },
  { weight: 1, arbitrary: fc.string() },
);

/** Any single registered codemod. */
const codemodArb: fc.Arbitrary<Codemod> = fc.constantFrom(...ALL_CODEMODS);

/** A non-empty subset of registered codemod ids, for the orchestrated path. */
const idSubsetArb: fc.Arbitrary<string[]> = fc
  .subarray(
    ALL_CODEMODS.map((c) => c.id),
    { minLength: 1 },
  );

/** Two distinct identifier names for an ad-hoc safeRenameCodemod. */
const NAME_POOL = ['Alpha', 'Beta', 'Gamma', 'Delta', 'doThing', 'oldName', 'newName', 'Widget'] as const;
const namePairArb: fc.Arbitrary<[string, string]> = fc
  .tuple(fc.constantFrom(...NAME_POOL), fc.constantFrom(...NAME_POOL))
  .filter(([a, b]) => a !== b);

// Feature: platform-leadership-gaps, Property 22: Codemods are idempotent
// Validates: Requirements 8.6
describe('Property 22: codemods are idempotent', () => {
  // Core contract: for any registered codemod and any source, applying it twice
  // equals applying it once — byte-for-byte.
  it('apply(apply(x)) === apply(x) for every registered codemod', () => {
    fc.assert(
      fc.property(codemodArb, sourceArb, (codemod, src) => {
        const once = codemod.apply(src).code;
        const twice = codemod.apply(once).code;
        assert.equal(twice, once, `codemod "${codemod.id}" is not idempotent`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // The orchestrated set is idempotent too: re-running the same id selection over
  // its own output is a byte-for-byte no-op.
  it('applyCodemods(applyCodemods(x).code) === applyCodemods(x).code for any id subset', () => {
    fc.assert(
      fc.property(idSubsetArb, sourceArb, (ids, src) => {
        const once = applyCodemods(src, ids).code;
        const twice = applyCodemods(once, ids).code;
        assert.equal(twice, once, `applyCodemods over [${ids.join(', ')}] is not idempotent`);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // The factory itself yields idempotent codemods for arbitrary identifier pairs,
  // not just the built-in renames.
  it('safeRenameCodemod produces an idempotent codemod for arbitrary name pairs', () => {
    fc.assert(
      fc.property(namePairArb, sourceArb, ([from, to], src) => {
        const cm = safeRenameCodemod('pbt-rename', from, to, 'routing', 'pbt');
        const once = cm.apply(src).code;
        const twice = cm.apply(once).code;
        assert.equal(twice, once, `safeRenameCodemod ${from}->${to} is not idempotent`);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
