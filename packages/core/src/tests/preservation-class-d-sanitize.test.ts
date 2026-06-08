// tests/preservation-class-d-sanitize.test.ts
// Class D preservation baseline (Property 7 — Non-Buggy Inputs Unchanged).
//
// Captures the CURRENT (pre-fix) behavior of sanitizeString / sanitizeDeep for
// the preservation domain:
//   - benign strings (no dangerous substring) are returned UNCHANGED
//   - the depth/length/array/key-count bounds behave exactly as observed today
//
// The Class D fix drives sanitizeString to an UNCONDITIONAL fixed point (removes
// the premature pass cap). That only affects inputs satisfying isBugCondition_D
// (still dangerous after a limited pass). Benign input already stabilizes on the
// first pass and must be byte-identical after the fix, and the MAX_DEPTH /
// MAX_STRING_LEN / MAX_ARRAY / MAX_KEYS bounds must be untouched: F(X) === F'(X).
//
// No fast-check available — Property-style coverage uses a deterministic seeded
// PRNG so sampled benign inputs are reproducible.
//
// **Validates: Requirements 3.4, 3.7**

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeString, sanitizeDeep } from '../security/xss.js';

// Observed bounds in security/xss.ts (the baseline that must stay unchanged).
const MAX_DEPTH = 32;
const MAX_STRING_LEN = 1_000_000;
const MAX_ARRAY = 10_000;

// ── Deterministic seeded PRNG (mulberry32) ───────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Benign alphabet: letters, digits, spaces and punctuation that sanitizeString
// never touches. Deliberately excludes '<' '>' and the bytes that could form
// `javascript:`, `data:`, `vbscript:` or `on*=` sequences are avoided by
// construction (no ':' adjacency to those keywords, no '=' after an on-word).
const BENIGN_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_.,/#!?()[]{}*';

function randomBenign(rng: () => number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += BENIGN_CHARS[Math.floor(rng() * BENIGN_CHARS.length)];
  return s;
}

// Mirror of sanitizeString's dangerous tokens — a benign string matches none.
const DANGEROUS = [/[<>]/, /javascript\s*:/i, /data\s*:/i, /vbscript\s*:/i, /on\w+\s*=/i, /\x00/];
function isBenign(s: string): boolean {
  return !DANGEROUS.some((re) => re.test(s));
}

describe('Class D preservation — benign sanitizeString is identity', () => {
  it('returns random benign strings unchanged', () => {
    const rng = mulberry32(0xd1d_5a6e);
    for (let trial = 0; trial < 1000; trial++) {
      const len = Math.floor(rng() * 64);
      const s = randomBenign(rng, len);
      if (!isBenign(s)) continue; // skip the rare accidental dangerous token
      assert.equal(sanitizeString(s), s, `benign input must be unchanged: ${JSON.stringify(s)}`);
    }
  });

  it('keeps fixed benign examples identical', () => {
    for (const s of ['hello world', 'a.b/c-d_e', 'café π façade', 'JSON {"k": 1}', '']) {
      assert.equal(sanitizeString(s), s);
    }
  });
});

describe('Class D preservation — bounds behave identically', () => {
  it('MAX_STRING_LEN: truncates an over-long string to the cap', () => {
    const over = 'a'.repeat(MAX_STRING_LEN + 25);
    const out = sanitizeString(over);
    assert.equal(out.length, MAX_STRING_LEN);
    assert.equal(out, 'a'.repeat(MAX_STRING_LEN));
  });

  it('MAX_DEPTH: nesting beyond the depth limit collapses to null', () => {
    // Build a chain of `depth` nested single-key objects with a benign leaf.
    const build = (depth: number): unknown => {
      let node: unknown = 'leaf';
      for (let i = 0; i < depth; i++) node = { next: node };
      return node;
    };

    // A shallow structure (within MAX_DEPTH) keeps its benign leaf intact.
    const shallow = sanitizeDeep(build(5)) as Record<string, unknown>;
    let cur: unknown = shallow;
    for (let i = 0; i < 5; i++) cur = (cur as Record<string, unknown>)['next'];
    assert.equal(cur, 'leaf');

    // A structure deeper than MAX_DEPTH collapses to null once depth > MAX_DEPTH.
    // Observed baseline: sanitizeDeep returns null only when `depth > MAX_DEPTH`
    // (i.e. at recursion depth MAX_DEPTH + 1). The object created at recursion
    // depth MAX_DEPTH therefore still exists, and it is its `next` child that
    // collapsed to null.
    const deep = sanitizeDeep(build(MAX_DEPTH + 10));
    let node: unknown = deep;
    for (let i = 0; i < MAX_DEPTH; i++) {
      assert.notEqual(node, null, `level ${i} should still be an object`);
      node = (node as Record<string, unknown>)['next'];
    }
    // The deepest surviving object (at depth MAX_DEPTH) retains a `next` that
    // recursion collapsed to null — this is the exact current boundary.
    assert.deepEqual(node, { next: null }, 'object at MAX_DEPTH survives with a null child');
    assert.equal(
      (node as Record<string, unknown>)['next'],
      null,
      'the child beyond MAX_DEPTH must collapse to null',
    );
  });

  it('MAX_ARRAY: truncates an over-long array to the cap', () => {
    const arr = new Array(MAX_ARRAY + 50).fill('x');
    const out = sanitizeDeep(arr) as unknown[];
    assert.ok(Array.isArray(out));
    assert.equal(out.length, MAX_ARRAY);
  });

  it('MAX_KEYS: caps the number of object keys at the observed boundary', () => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < 600; i++) obj[`k${i}`] = 'v';
    const out = sanitizeDeep(obj) as Record<string, unknown>;
    // Observed pre-fix behavior: the `keyCount++ > MAX_KEYS` guard admits 501
    // keys before breaking. Lock that exact count as the baseline.
    assert.equal(Object.keys(out).length, 501);
  });

  it('passes through numbers, booleans, null and undefined unchanged', () => {
    assert.equal(sanitizeDeep(42), 42);
    assert.equal(sanitizeDeep(true), true);
    assert.equal(sanitizeDeep(null), null);
    assert.equal(sanitizeDeep(undefined), undefined);
  });
});
