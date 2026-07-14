import { test } from 'node:test';
import assert from 'node:assert/strict';

import { JwtService } from '../jwt.js';
import { JWT_SERVICE } from '../index.js';

const SECRET = 'a-sufficiently-long-secret-value-32+';

test('constructor rejects short secrets', () => {
  assert.throws(() => new JwtService('too-short'), /at least 32 characters/);
});

test('sign then verify round-trips claims and stamps iat', () => {
  const jwt = new JwtService(SECRET);
  const token = jwt.sign({ sub: '7', roles: ['admin'], email: 'a@b.c' });
  const claims = jwt.verify(token);
  assert.equal(claims?.sub, '7');
  assert.deepEqual(claims?.roles, ['admin']);
  assert.equal(typeof claims?.iat, 'number');
});

test('a token is three base64url segments', () => {
  const token = new JwtService(SECRET).sign({ sub: '1' });
  assert.equal(token.split('.').length, 3);
});

test('verify returns null for a tampered payload', () => {
  const jwt = new JwtService(SECRET);
  const token = jwt.sign({ sub: '7', roles: ['user'] });
  const [h, , s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: '7', roles: ['admin'] })).toString('base64url');
  assert.equal(jwt.verify(`${h}.${forged}.${s}`), null);
});

test('verify returns null for a token signed with a different secret', () => {
  const a = new JwtService(SECRET);
  const b = new JwtService('another-secret-that-is-long-enough-xx');
  assert.equal(b.verify(a.sign({ sub: '7' })), null);
});

test('expired tokens fail verification', () => {
  const jwt = new JwtService(SECRET);
  const token = jwt.sign({ sub: '7' }, { expiresInSeconds: -10 });
  assert.equal(jwt.verify(token), null);
});

test('nbf in the future fails verification', () => {
  const jwt = new JwtService(SECRET);
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign({ sub: '7', nbf: now + 1000 });
  assert.equal(jwt.verify(token), null);
});

test('algorithm confusion is rejected (alg:none / non-HS256 header)', () => {
  const jwt = new JwtService(SECRET);
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: '7' })).toString('base64url');
  assert.equal(jwt.verify(`${header}.${payload}.`), null);
});

test('issuer and audience are enforced when requested', () => {
  const jwt = new JwtService(SECRET);
  const token = jwt.sign({ sub: '7' }, { issuer: 'street', audience: 'api' });
  assert.ok(jwt.verify(token, { issuer: 'street', audience: 'api' }));
  assert.equal(jwt.verify(token, { issuer: 'other' }), null);
  assert.equal(jwt.verify(token, { audience: 'other' }), null);
});

test('malformed tokens return null', () => {
  const jwt = new JwtService(SECRET);
  assert.equal(jwt.verify('only.two'), null);
  assert.equal(jwt.verify('a.b.c'), null);
  assert.equal(jwt.verify('...'), null);
});

test('a signature of the wrong length is rejected', () => {
  const jwt = new JwtService(SECRET);
  const [h, p] = jwt.sign({ sub: '7' }).split('.');
  assert.equal(jwt.verify(`${h}.${p}.AA`), null); // valid base64url, wrong length
});

test('a correctly-signed but non-JSON payload is rejected', () => {
  const jwt = new JwtService(SECRET);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const badPayload = Buffer.from('not-json{').toString('base64url');
  const sig = createHmac('sha256', SECRET).update(`${header}.${badPayload}`).digest('base64url');
  assert.equal(jwt.verify(`${header}.${badPayload}.${sig}`), null);
});

test('decode returns null when the payload segment is not JSON', () => {
  const jwt = new JwtService(SECRET);
  const badPayload = Buffer.from('not-json{').toString('base64url');
  assert.equal(jwt.decode(`aaa.${badPayload}.ccc`), null);
});

test('decode reads the payload without verifying', () => {
  const jwt = new JwtService(SECRET);
  const token = jwt.sign({ sub: '7', roles: ['x'] });
  assert.equal(jwt.decode(token)?.sub, '7');
  assert.equal(jwt.decode('bad'), null);
  // decode does not validate the signature:
  const [h, p] = token.split('.');
  assert.equal(jwt.decode(`${h}.${p}.deadbeef`)?.sub, '7');
});

test('DI token is a stable global symbol', () => {
  assert.equal(JWT_SERVICE, Symbol.for('@streetjs/security:JwtService'));
});
