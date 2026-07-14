import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEVELS,
  EMITTING_LEVELS,
  isLevelName,
  severityOf,
  levelNameOf,
} from '../levels.js';
import { LOGGER } from '../index.js';

test('LEVELS is frozen and ordered by severity', () => {
  assert.ok(Object.isFrozen(LEVELS));
  assert.ok(LEVELS.trace < LEVELS.debug);
  assert.ok(LEVELS.debug < LEVELS.info);
  assert.ok(LEVELS.info < LEVELS.warn);
  assert.ok(LEVELS.warn < LEVELS.error);
  assert.ok(LEVELS.error < LEVELS.fatal);
  assert.ok(LEVELS.fatal < LEVELS.silent);
});

test('EMITTING_LEVELS excludes silent', () => {
  assert.equal(EMITTING_LEVELS.includes('silent' as never), false);
  assert.equal(EMITTING_LEVELS.length, 6);
});

test('isLevelName recognizes known names only', () => {
  assert.equal(isLevelName('info'), true);
  assert.equal(isLevelName('silent'), true);
  assert.equal(isLevelName('verbose'), false);
  assert.equal(isLevelName(30), false);
  assert.equal(isLevelName(undefined), false);
});

test('severityOf maps names to numbers and rejects unknowns', () => {
  assert.equal(severityOf('warn'), 40);
  assert.throws(() => severityOf('nope' as never), RangeError);
});

test('levelNameOf reverses severity lookups', () => {
  assert.equal(levelNameOf(50), 'error');
  assert.equal(levelNameOf(999), undefined);
});

test('LOGGER token is a stable global symbol', () => {
  assert.equal(typeof LOGGER, 'symbol');
  assert.equal(LOGGER, Symbol.for('@streetjs/logging:Logger'));
});
