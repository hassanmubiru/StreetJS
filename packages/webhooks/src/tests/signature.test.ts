import { test } from 'node:test';
import assert from 'node:assert/strict';

import { signPayload, verifySignature, parseSignatureHeader } from '../signature.js';

const SECRET = 'whsec_test';
const PAYLOAD = JSON.stringify({ id: 'evt_1', type: 'user.created', data: { id: 7 } });

test('signPayload produces a t=,v1= header', () => {
  const sig = signPayload(PAYLOAD, SECRET, { timestamp: 1000 });
  assert.equal(sig.timestamp, 1000);
  assert.match(sig.header, /^t=1000,v1=[0-9a-f]{64}$/);
  assert.equal(sig.header, `t=1000,v1=${sig.signature}`);
});

test('a valid signature verifies within tolerance', () => {
  const sig = signPayload(PAYLOAD, SECRET, { timestamp: 1000 });
  const result = verifySignature(PAYLOAD, sig.header, SECRET, { now: 1010, toleranceSec: 300 });
  assert.equal(result.valid, true);
});

test('a tampered payload fails with signature mismatch', () => {
  const sig = signPayload(PAYLOAD, SECRET, { timestamp: 1000 });
  const result = verifySignature(PAYLOAD + 'x', sig.header, SECRET, { now: 1000 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'signature mismatch');
});

test('a wrong secret fails with signature mismatch', () => {
  const sig = signPayload(PAYLOAD, SECRET, { timestamp: 1000 });
  const result = verifySignature(PAYLOAD, sig.header, 'other-secret', { now: 1000 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'signature mismatch');
});

test('an expired timestamp fails (replay protection)', () => {
  const sig = signPayload(PAYLOAD, SECRET, { timestamp: 1000 });
  const result = verifySignature(PAYLOAD, sig.header, SECRET, { now: 2000, toleranceSec: 300 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'timestamp outside tolerance');
});

test('a future timestamp beyond tolerance fails', () => {
  const sig = signPayload(PAYLOAD, SECRET, { timestamp: 2000 });
  const result = verifySignature(PAYLOAD, sig.header, SECRET, { now: 1000, toleranceSec: 300 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'timestamp outside tolerance');
});

test('malformed headers fail cleanly', () => {
  assert.equal(verifySignature(PAYLOAD, 'garbage', SECRET, { now: 1000 }).reason, 'malformed signature header');
  assert.equal(verifySignature(PAYLOAD, 't=1000', SECRET, { now: 1000 }).reason, 'malformed signature header');
  assert.equal(verifySignature(PAYLOAD, 'v1=abc', SECRET, { now: 1000 }).reason, 'malformed signature header');
});

test('parseSignatureHeader extracts t and v1, ignoring extras, bare parts, and whitespace', () => {
  assert.deepEqual(parseSignatureHeader('t=123, v1=deadbeef, v0=old, bare'), { t: 123, v1: 'deadbeef' });
  assert.equal(parseSignatureHeader('t=notnum,v1=x'), null);
  assert.equal(parseSignatureHeader('nope'), null);
  // A non-string input is rejected.
  assert.equal(parseSignatureHeader(undefined as unknown as string), null);
});

test('an empty v1 fails without throwing', () => {
  const result = verifySignature(PAYLOAD, 't=1000,v1=', SECRET, { now: 1000 });
  assert.equal(result.valid, false);
});

test('a v1 of the wrong length fails without throwing', () => {
  const result = verifySignature(PAYLOAD, 't=1000,v1=abcd', SECRET, { now: 1000 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'signature mismatch');
});

test('non-hex v1 fails without throwing', () => {
  const sixtyFour = 'z'.repeat(64);
  const result = verifySignature(PAYLOAD, `t=1000,v1=${sixtyFour}`, SECRET, { now: 1000 });
  assert.equal(result.valid, false);
});
