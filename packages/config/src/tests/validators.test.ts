// Unit tests for the low-level validators/coercers.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateString,
  validateNumber,
  validateBoolean,
  validateEnum,
  validateArray,
  validateObject,
  validateDuration,
  validateUrl,
  validatePath,
  validateHostname,
  validateIp,
  validateEmail,
  type Outcome,
} from '../index.js';

function value<T>(o: Outcome<T>): T {
  assert.equal(o.ok, true, o.ok ? '' : o.message);
  return (o as { ok: true; value: T }).value;
}
function failed<T>(o: Outcome<T>): { expected: string; message: string } {
  assert.equal(o.ok, false, 'expected failure');
  return o as { ok: false; expected: string; message: string };
}

describe('validateString', () => {
  it('accepts and trims strings, enforces length + pattern', () => {
    assert.equal(value(validateString('  hi  ')), 'hi');
    assert.equal(value(validateString('abc', { minLength: 3 })), 'abc');
    assert.equal(failed(validateString('ab', { minLength: 3 })).expected, 'string (min length 3)');
    assert.equal(failed(validateString('abcd', { maxLength: 3 })).ok ?? false, false);
    assert.ok(value(validateString('a1', { pattern: /^[a-z]\d$/ })));
    assert.ok(failed(validateString('11', { pattern: /^[a-z]\d$/ })).message.includes('pattern'));
    assert.equal(failed(validateString(5)).expected, 'string');
  });
});

describe('validateNumber', () => {
  it('coerces numeric strings and enforces bounds/integer', () => {
    assert.equal(value(validateNumber('42')), 42);
    assert.equal(value(validateNumber(3.14)), 3.14);
    assert.equal(value(validateNumber('10', { min: 1, max: 100 })), 10);
    assert.ok(failed(validateNumber('0', { min: 1 })).message.includes('below minimum'));
    assert.ok(failed(validateNumber('3.5', { integer: true })).message.includes('integer'));
    assert.equal(failed(validateNumber('abc')).expected, 'number');
    assert.equal(failed(validateNumber('')).expected, 'number');
  });
});

describe('validateBoolean', () => {
  it('accepts booleans and common string forms', () => {
    for (const t of [true, 'true', '1', 'YES', 'on']) assert.equal(value(validateBoolean(t)), true);
    for (const f of [false, 'false', '0', 'no', 'OFF']) assert.equal(value(validateBoolean(f)), false);
    assert.equal(failed(validateBoolean('maybe')).expected, 'boolean');
  });
});

describe('validateEnum', () => {
  it('accepts allowed values only', () => {
    const vals = ['a', 'b', 'c'] as const;
    assert.equal(value(validateEnum('b', vals)), 'b');
    assert.ok(failed(validateEnum('z', vals)).message.includes('not an allowed value'));
  });
});

describe('validateArray', () => {
  const num = (i: unknown): Outcome<number> => validateNumber(i);
  it('splits delimited strings and validates items', () => {
    assert.deepEqual(value(validateArray('1,2,3', num)), [1, 2, 3]);
    assert.deepEqual(value(validateArray([4, 5], num)), [4, 5]);
    assert.deepEqual(value(validateArray('', num)), []);
    assert.ok(failed(validateArray('1,x', num)).message.includes('item 1'));
    assert.ok(failed(validateArray('1', num, { minItems: 2 })).message.includes('too few'));
  });
});

describe('validateObject', () => {
  it('accepts plain objects only', () => {
    assert.deepEqual(value(validateObject({ a: 1 })), { a: 1 });
    assert.equal(failed(validateObject([1])).expected, 'object');
    assert.equal(failed(validateObject(null)).expected, 'object');
  });
});

describe('validateDuration', () => {
  it('parses duration strings into milliseconds', () => {
    assert.equal(value(validateDuration('500ms')), 500);
    assert.equal(value(validateDuration('2s')), 2000);
    assert.equal(value(validateDuration('5m')), 300000);
    assert.equal(value(validateDuration('1h')), 3600000);
    assert.equal(value(validateDuration('1d')), 86400000);
    assert.equal(value(validateDuration('250')), 250);
    assert.equal(value(validateDuration(1000)), 1000);
    assert.equal(failed(validateDuration('soon')).expected, 'duration');
  });
});

describe('validateUrl', () => {
  it('validates URLs and protocol allowlists', () => {
    assert.equal(value(validateUrl('https://example.com')), 'https://example.com');
    assert.equal(value(validateUrl('postgres://u:p@h:5432/db', { protocols: ['postgres'] })), 'postgres://u:p@h:5432/db');
    assert.ok(failed(validateUrl('http://x', { protocols: ['https'] })).message.includes('not allowed'));
    assert.ok(failed(validateUrl('not a url')).message.includes('not a valid URL'));
  });
});

describe('validatePath', () => {
  it('rejects empty and null-byte paths', () => {
    assert.equal(value(validatePath('/var/data')), '/var/data');
    assert.equal(failed(validatePath('')).message, 'path must not be empty');
    assert.ok(failed(validatePath('a\0b')).message.includes('null byte'));
  });
});

describe('validateHostname', () => {
  it('accepts RFC-1123 hostnames, rejects invalid', () => {
    assert.equal(value(validateHostname('db.internal.example.com')), 'db.internal.example.com');
    assert.equal(value(validateHostname('localhost')), 'localhost');
    assert.ok(failed(validateHostname('-bad.example')).message.includes('not a valid'));
    assert.ok(failed(validateHostname('a..b')).message.includes('not a valid'));
  });
});

describe('validateIp', () => {
  it('validates IPv4/IPv6 and enforces version', () => {
    assert.equal(value(validateIp('127.0.0.1')), '127.0.0.1');
    assert.equal(value(validateIp('::1')), '::1');
    assert.equal(value(validateIp('10.0.0.1', 4)), '10.0.0.1');
    assert.ok(failed(validateIp('::1', 4)).message.includes('IPv6, expected IPv4'));
    assert.ok(failed(validateIp('999.1.1.1')).message.includes('not a valid'));
  });
});

describe('validateEmail', () => {
  it('accepts valid emails, rejects malformed', () => {
    assert.equal(value(validateEmail('dev@example.com')), 'dev@example.com');
    assert.ok(failed(validateEmail('nope')).message.includes('not a valid'));
    assert.ok(failed(validateEmail('a@b')).message.includes('not a valid'));
  });
});
