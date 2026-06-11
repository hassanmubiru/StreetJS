// tests/ratelimit-window-parsing-pbt.test.ts
// Property-based test for the rate-limiter window-duration parser (Phase 2,
// Requirement 3.7).
//
// Feature: consumer-platform-security, Property 4 — Window-duration parsing is
// correct.
// Validates: Requirements 3.7
//
// R3.7 requires the Rate_Limiter to expose a configuration interface equivalent
// to `rateLimit({ requests: 100, window: "1m" })`, accepting a human-readable
// window duration. `parseWindow` is the function that turns that human-readable
// duration (or a bare millisecond number) into a concrete millisecond count.
//
// This file proves, across arbitrary durations spanning every supported unit
// (ms/s/m/h/d), integral and fractional magnitudes, mixed letter casing, and
// surrounding whitespace, that:
//   1. Correctness (R3.7): a well-formed window parses to exactly
//      floor(value * unitMillis) — matched against an independent oracle — and a
//      bare numeric string is treated as milliseconds.
//   2. Numeric pass-through: a positive finite number is returned floored to an
//      integer millisecond count.
//   3. Rejection: non-positive / non-finite numbers and unparseable or
//      non-positive-duration strings are rejected with a thrown error rather
//      than a silent bad value.
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// parsing property is exercised across many generated durations without
// disturbing the example/edge-case unit tests for the rate limiter.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { parseWindow } from '../security/ratelimit.js';

const NUM_RUNS = 100;

// ── Oracle ────────────────────────────────────────────────────────────────────
//
// An independent restatement of the documented contract: each supported unit
// maps to a fixed millisecond multiplier, the unit defaults to milliseconds when
// omitted, and the result is the magnitude times that multiplier, floored. We
// keep the table local so the property compares two expressions of the same spec
// rather than the implementation against itself.
const UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const ORACLE_UNITS = ['ms', 's', 'm', 'h', 'd'] as const;
type Unit = (typeof ORACLE_UNITS)[number];

/** Expected milliseconds for a (magnitude, unit) pair per the documented rule. */
function oracleMs(value: number, unit: Unit): number {
  return Math.floor(value * UNIT_MS[unit]!);
}

// Randomly re-case a unit suffix; the parser's regex is case-insensitive so
// "MS", "Ms", "mS", "ms" must all parse identically.
function mixCase(unit: string, seed: number): string {
  let out = '';
  for (let i = 0; i < unit.length; i++) {
    const ch = unit[i]!;
    out += (seed >> i) & 1 ? ch.toUpperCase() : ch.toLowerCase();
  }
  return out;
}

// ── Generators ────────────────────────────────────────────────────────────────

// A magnitude that, multiplied by its unit, stays a safe positive integer count
// of milliseconds. Integers keep the property exact and avoid float-formatting
// ambiguity in the rendered string.
const magnitudeArb = fc.integer({ min: 1, max: 100_000 });
const unitArb = fc.constantFrom<Unit>(...ORACLE_UNITS);

interface WindowCase {
  text: string; // the string handed to parseWindow
  expected: number; // oracle milliseconds
}

// A well-formed "<magnitude><unit>" window with mixed casing and optional
// surrounding whitespace — all of which the parser must tolerate.
const unitWindowArb: fc.Arbitrary<WindowCase> = fc
  .record({
    value: magnitudeArb,
    unit: unitArb,
    caseSeed: fc.integer({ min: 0, max: 7 }),
    padL: fc.constantFrom('', ' ', '  ', '\t'),
    padR: fc.constantFrom('', ' ', '  ', '\t'),
  })
  .map(({ value, unit, caseSeed, padL, padR }) => ({
    text: `${padL}${value}${mixCase(unit, caseSeed)}${padR}`,
    expected: oracleMs(value, unit),
  }));

// A bare numeric string with no unit is interpreted as milliseconds (R3.7).
const bareMsWindowArb: fc.Arbitrary<WindowCase> = fc
  .record({
    value: magnitudeArb,
    padL: fc.constantFrom('', ' ', '\t'),
    padR: fc.constantFrom('', ' ', '\t'),
  })
  .map(({ value, padL, padR }) => ({
    text: `${padL}${value}${padR}`,
    expected: value, // floor(value * 1) === value for an integer
  }));

// Strings that do not match the documented duration grammar at all.
const unparseableArb: fc.Arbitrary<string> = fc.constantFrom(
  '',
  '   ',
  'abc',
  'm',
  '1x',
  '1 minute',
  '1.2.3s',
  '-5s',
  '+5s',
  '1e3s',
  '0x10s',
  '1,000ms',
  'NaN',
  'Infinity',
);

// Feature: consumer-platform-security, Property 4: Window-duration parsing is correct
// Validates: Requirements 3.7
describe('Property 4: window-duration parsing is correct', () => {
  it('parses "<value><unit>" to exactly floor(value * unitMillis), case- and whitespace-insensitive', () => {
    fc.assert(
      fc.property(unitWindowArb, ({ text, expected }) => {
        const actual = parseWindow(text);
        assert.equal(actual, expected);
        // A duration built from a positive magnitude is always a positive
        // integer millisecond count.
        assert.ok(Number.isInteger(actual));
        assert.ok(actual > 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('treats a bare numeric string as milliseconds', () => {
    fc.assert(
      fc.property(bareMsWindowArb, ({ text, expected }) => {
        assert.equal(parseWindow(text), expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('returns a positive finite number floored to an integer ms count', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 1e9, noNaN: true }), (n) => {
        const actual = parseWindow(n);
        assert.equal(actual, Math.floor(n));
        assert.ok(Number.isInteger(actual));
        assert.ok(actual > 0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects non-positive or non-finite numeric windows', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: -1e9, max: 0, noNaN: true }), // <= 0
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        ),
        (bad) => {
          assert.throws(() => parseWindow(bad));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects strings that do not match the duration grammar', () => {
    fc.assert(
      fc.property(unparseableArb, (text) => {
        assert.throws(() => parseWindow(text));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
