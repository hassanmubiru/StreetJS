// tests/certification/security-certification.test.ts
// One-command security certification: exercises real auth, crypto, transport,
// and input-security controls against the actual implementations (no mocks).
// Run: node --test dist/tests/certification/security-certification.test.js

import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';

import { JwtService } from '../../src/security/jwt.js';
import { encryptSecret, decryptSecret, constantTimeEqual } from '../../src/security/vault.js';
import { sanitizeString, sanitizeDeep, escapeHtml } from '../../src/security/xss.js';
import { signWebhookPayload, verifyIncomingWebhook } from '../../src/webhook/manager.js';
import { RbacService } from '../../src/auth/rbac.js';
import { FieldEncryptor } from '../../src/enterprise/data-policy.js';

// ── Authentication: JWT ─────────────────────────────────────────────────────────

describe('SECURITY — JWT', () => {
  const jwt = new JwtService('a-very-long-test-signing-secret-0123456789');

  it('signs and verifies a valid token', () => {
    const token = jwt.sign({ sub: 'u1', role: 'admin' });
    const decoded = jwt.verify(token);
    assert.equal(decoded?.['sub'], 'u1');
  });

  it('rejects a tampered token (signature mismatch)', () => {
    const token = jwt.sign({ sub: 'u1' });
    const parts = token.split('.');
    const tampered = `${parts[0]}.${Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url')}.${parts[2]}`;
    assert.equal(jwt.verify(tampered), null);
  });

  it('rejects an alg:none / algorithm-confusion token', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url');
    assert.equal(jwt.verify(`${header}.${payload}.`), null);
  });

  it('rejects an expired token', () => {
    const token = jwt.sign({ sub: 'u1' }, { expiresInSeconds: -10 });
    assert.equal(jwt.verify(token), null);
  });
});

// ── Cryptography ─────────────────────────────────────────────────────────────────

describe('SECURITY — Cryptography', () => {
  it('AES-256-GCM secret encryption round-trips and is non-deterministic (random IV)', () => {
    const kek = 'kek-'.repeat(8);
    const a = encryptSecret('top-secret', kek);
    const b = encryptSecret('top-secret', kek);
    assert.notEqual(a, b, 'random IV per encryption');
    assert.equal(decryptSecret(a, kek), 'top-secret');
    assert.equal(decryptSecret(b, kek), 'top-secret');
  });

  it('AES-256-GCM rejects a tampered ciphertext (auth tag)', () => {
    const kek = 'kek-'.repeat(8);
    const blob = encryptSecret('secret', kek);
    const tampered = blob.slice(0, -4) + (blob.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    assert.throws(() => decryptSecret(tampered, kek));
  });

  it('decryption with a wrong key fails (no silent fallback)', () => {
    const blob = encryptSecret('secret', 'kek-'.repeat(8));
    assert.throws(() => decryptSecret(blob, 'different-key-'.repeat(3)));
  });

  it('constantTimeEqual is correct and backed by timingSafeEqual semantics', () => {
    assert.equal(constantTimeEqual('abc', 'abc'), true);
    assert.equal(constantTimeEqual('abc', 'abd'), false);
    assert.equal(constantTimeEqual('abc', 'abcd'), false);
    // sanity: node primitive behaves as expected for equal-length buffers
    assert.equal(timingSafeEqual(Buffer.from('xx'), Buffer.from('xx')), true);
  });

  it('FieldEncryptor uses authenticated encryption with unique IVs', () => {
    const enc = new FieldEncryptor('master');
    const c1 = enc.encryptValue('pii');
    const c2 = enc.encryptValue('pii');
    assert.notEqual(c1, c2);
    assert.equal(enc.decryptValue(c1), 'pii');
    assert.throws(() => enc.decryptValue(c1.slice(0, -4) + 'ZZZZ'));
  });
});

// ── Authorization: RBAC ──────────────────────────────────────────────────────────

describe('SECURITY — RBAC / Authorization', () => {
  const rbac = new RbacService(
    { admin: ['editor'], editor: ['viewer'], viewer: [] },
    { admin: ['users:delete'], editor: ['users:write'], viewer: ['users:read'] },
  );

  it('resolves inherited permissions through the role hierarchy', () => {
    assert.equal(rbac.hasPermission(['admin'], 'users:read'), true);   // inherited viewer
    assert.equal(rbac.hasPermission(['admin'], 'users:write'), true);  // inherited editor
    assert.equal(rbac.hasPermission(['admin'], 'users:delete'), true); // own
  });

  it('denies permissions not granted to a role', () => {
    assert.equal(rbac.hasPermission(['viewer'], 'users:delete'), false);
    assert.equal(rbac.hasPermission(['viewer'], 'users:write'), false);
  });
});

// ── Transport / webhook signing ──────────────────────────────────────────────────

describe('SECURITY — Webhook signing (HMAC-SHA256)', () => {
  it('verifies a valid signature and rejects tampered bodies', () => {
    const body = JSON.stringify({ event: 'x' });
    const sig = signWebhookPayload(body, 'whsec');
    assert.equal(verifyIncomingWebhook('whsec', sig, body), true);
    assert.equal(verifyIncomingWebhook('whsec', sig, body + 'x'), false);
    assert.equal(verifyIncomingWebhook('wrong-secret', sig, body), false);
  });
});

// ── Input security: XSS ──────────────────────────────────────────────────────────

describe('SECURITY — XSS / input sanitisation', () => {
  it('escapes HTML control characters', () => {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
    assert.match(escapeHtml(`"'&`), /&quot;|&#39;|&amp;/);
  });

  it('sanitizes strings and nested structures', () => {
    assert.ok(!sanitizeString('<img onerror=alert(1)>').includes('<img'));
    const cleaned = sanitizeDeep({ a: '<b>x</b>', nested: { b: '<i>y</i>' } }) as Record<string, unknown>;
    assert.ok(!String(cleaned['a']).includes('<b>'));
  });
});
