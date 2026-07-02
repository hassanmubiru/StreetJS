// src/tests/matcher.test.ts
// Unit + property tests for the wildcard matcher (matcher.ts).
//
// Validates the documented semantics: `*` matches exactly one segment, `**`
// matches one or more segments, and a pattern with no `*` matches only the
// exact name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { isWildcard, matchesPattern } from '../matcher.js';

// ── isWildcard ────────────────────────────────────────────────────────────────

test('isWildcard detects patterns containing "*"', () => {
  assert.equal(isWildcard('user.*'), true);
  assert.equal(isWildcard('user.**'), true);
  assert.equal(isWildcard('*'), true);
  assert.equal(isWildcard('user.created'), false);
  assert.equal(isWildcard('a.b.c'), false);
});

// ── Exact matching ───────────────────────────────────────────────────────────

test('a non-wildcard pattern matches only its exact name', () => {
  assert.equal(matchesPattern('user.created', 'user.created'), true);
  assert.equal(matchesPattern('user.updated', 'user.created'), false);
  assert.equal(matchesPattern('user.created.extra', 'user.created'), false);
});

// ── Single-segment wildcard `*` ───────────────────────────────────────────────

test('`user.*` matches exactly one trailing segment', () => {
  assert.equal(matchesPattern('user.created', 'user.*'), true);
  assert.equal(matchesPattern('user.updated', 'user.*'), true);
  assert.equal(matchesPattern('user.profile.updated', 'user.*'), false); // two segments
  assert.equal(matchesPattern('order.created', 'user.*'), false);
  assert.equal(matchesPattern('user', 'user.*'), false); // no trailing segment
});

test('a bare `*` matches only single-segment names', () => {
  assert.equal(matchesPattern('ping', '*'), true);
  assert.equal(matchesPattern('user.created', '*'), false);
});

test('`*` can appear in the middle and matches exactly one segment', () => {
  assert.equal(matchesPattern('user.created.v1', 'user.*.v1'), true);
  assert.equal(matchesPattern('user.a.b.v1', 'user.*.v1'), false);
});

// ── Deep wildcard `**` ─────────────────────────────────────────────────────────

test('`user.**` matches one or more trailing segments', () => {
  assert.equal(matchesPattern('user.created', 'user.**'), true);
  assert.equal(matchesPattern('user.profile.updated', 'user.**'), true);
  assert.equal(matchesPattern('user.a.b.c', 'user.**'), true);
  assert.equal(matchesPattern('user', 'user.**'), false); // needs >= 1 trailing segment
  assert.equal(matchesPattern('order.created', 'user.**'), false);
});

test('a bare `**` matches any non-empty event name', () => {
  assert.equal(matchesPattern('ping', '**'), true);
  assert.equal(matchesPattern('user.created', '**'), true);
  assert.equal(matchesPattern('a.b.c.d', '**'), true);
});

// ── Property: exact patterns match iff strings are equal ───────────────────────

test('property: a dot-delimited exact pattern matches iff the name equals it', () => {
  const segment = fc.stringMatching(/^[a-z]{1,6}$/);
  const name = fc.array(segment, { minLength: 1, maxLength: 4 }).map((s) => s.join('.'));
  fc.assert(
    fc.property(name, name, (a, b) => {
      // Exact (no wildcard) pattern: match iff strings are identical.
      assert.equal(matchesPattern(a, b), a === b);
    }),
    { numRuns: 200 },
  );
});

// ── Property: `prefix.*` matches iff name = prefix + exactly one more segment ──

test('property: `prefix.*` matches a name iff it is prefix followed by exactly one segment', () => {
  const segment = fc.stringMatching(/^[a-z]{1,5}$/);
  fc.assert(
    fc.property(
      segment, // prefix
      fc.array(segment, { minLength: 0, maxLength: 4 }), // trailing segments
      (prefix, trailing) => {
        const name = [prefix, ...trailing].join('.');
        const pattern = `${prefix}.*`;
        // Matches iff there is exactly one trailing segment.
        assert.equal(matchesPattern(name, pattern), trailing.length === 1);
      },
    ),
    { numRuns: 200 },
  );
});

// ── Property: `prefix.**` matches iff name = prefix + one-or-more segments ─────

test('property: `prefix.**` matches a name iff it is prefix followed by >= 1 segment', () => {
  const segment = fc.stringMatching(/^[a-z]{1,5}$/);
  fc.assert(
    fc.property(
      segment,
      fc.array(segment, { minLength: 0, maxLength: 4 }),
      (prefix, trailing) => {
        const name = [prefix, ...trailing].join('.');
        const pattern = `${prefix}.**`;
        assert.equal(matchesPattern(name, pattern), trailing.length >= 1);
      },
    ),
    { numRuns: 200 },
  );
});
