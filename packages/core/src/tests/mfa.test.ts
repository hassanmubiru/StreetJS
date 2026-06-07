// tests/mfa.test.ts
// TOTP/HOTP correctness against the published RFC 4226 / RFC 6238 test vectors,
// plus MfaService enrollment/verify/recovery-code paths against a fake pool.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hotp, totp, verifyTotp, base32Encode, base32Decode,
  generateRecoveryCodes, MfaService, MFA_MIGRATION_SQL,
} from '../auth/mfa.js';

// RFC 4226 / RFC 6238 reference secret: ASCII "12345678901234567890".
const SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('HOTP — RFC 4226 Appendix D vectors', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  it('matches all 10 reference counters', () => {
    for (let c = 0; c < expected.length; c++) {
      assert.equal(hotp(SECRET, BigInt(c)), expected[c], `counter ${c}`);
    }
  });
});

describe('TOTP — RFC 6238 Appendix B vectors (SHA1, 8 digits)', () => {
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  it('matches the RFC time vectors', () => {
    for (const [t, code] of vectors) {
      assert.equal(totp(SECRET, { digits: 8, algorithm: 'SHA1' }, t * 1000), code, `t=${t}`);
    }
  });
});

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    const buf = Buffer.from('the quick brown fox', 'utf8');
    assert.deepEqual([...base32Decode(base32Encode(buf))], [...buf]);
  });
  it('decodes a known RFC 4648 vector ("foobar")', () => {
    assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
    assert.equal(base32Decode('MZXW6YTBOI').toString(), 'foobar');
  });
});

describe('verifyTotp', () => {
  it('accepts the current code and rejects a wrong one (constant-time)', () => {
    const now = 1_700_000_000_000;
    const code = totp(SECRET, {}, now);
    assert.equal(verifyTotp(SECRET, code, {}, now), true);
    assert.equal(verifyTotp(SECRET, '000000', {}, now), false);
  });
  it('tolerates ±1 period of clock skew', () => {
    const now = 1_700_000_000_000;
    const prev = totp(SECRET, {}, now - 30_000);
    const next = totp(SECRET, {}, now + 30_000);
    assert.equal(verifyTotp(SECRET, prev, { window: 1 }, now), true);
    assert.equal(verifyTotp(SECRET, next, { window: 1 }, now), true);
  });
  it('rejects malformed input', () => {
    assert.equal(verifyTotp(SECRET, 'abcdef'), false);
    assert.equal(verifyTotp(SECRET, '12345'), false);
  });
});

describe('generateRecoveryCodes', () => {
  it('produces unique formatted codes', () => {
    const codes = generateRecoveryCodes(10);
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const c of codes) assert.match(c, /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{2}$/);
  });
});

// ── MfaService against a fake SQL pool ──────────────────────────────────────────

class FakeMfaPool {
  store = new Map<string, Record<string, unknown>>();
  async query(sql: string, params: unknown[] = []) {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('INSERT INTO STREET_MFA')) {
      this.store.set(String(params[0]), { user_id: params[0], secret_b32: params[1], enabled: false, recovery_hashes: JSON.parse(String(params[2])) });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE STREET_MFA SET ENABLED')) {
      const r = this.store.get(String(params[0])); if (r) r['enabled'] = true;
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE STREET_MFA SET RECOVERY_HASHES')) {
      const r = this.store.get(String(params[0])); if (r) r['recovery_hashes'] = JSON.parse(String(params[1]));
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('DELETE FROM STREET_MFA')) { this.store.delete(String(params[0])); return { rows: [], rowCount: 1 }; }
    if (s.startsWith('SELECT')) {
      const r = this.store.get(String(params[0]));
      return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  }
}

describe('MfaService', () => {
  it('migration SQL declares the street_mfa table', () => {
    assert.match(MFA_MIGRATION_SQL, /CREATE TABLE IF NOT EXISTS street_mfa/);
  });

  it('enroll → confirm → verify lifecycle works', async () => {
    const pool = new FakeMfaPool();
    const svc = new MfaService(pool, { issuer: 'StreetTest' });
    const enrollment = await svc.beginEnrollment('user-1', 'alice@example.com');
    assert.match(enrollment.otpauthUrl, /^otpauth:\/\/totp\/StreetTest:alice/);
    assert.equal(enrollment.recoveryCodes.length, 10);
    assert.equal(await svc.isEnabled('user-1'), false);

    // Confirm with a freshly computed code from the enrolled secret.
    const secret = base32Decode(enrollment.secret);
    const code = totp(secret);
    assert.equal(await svc.confirmEnrollment('user-1', code), true);
    assert.equal(await svc.isEnabled('user-1'), true);
    assert.equal(await svc.verify('user-1', totp(secret)), true);
    assert.equal(await svc.verify('user-1', '000000'), false);
  });

  it('recovery codes are single-use', async () => {
    const pool = new FakeMfaPool();
    const svc = new MfaService(pool);
    const { recoveryCodes, secret } = await svc.beginEnrollment('user-2', 'bob');
    await svc.confirmEnrollment('user-2', totp(base32Decode(secret)));
    const code = recoveryCodes[0]!;
    assert.equal(await svc.useRecoveryCode('user-2', code), true);
    // Second use of the same code must fail.
    assert.equal(await svc.useRecoveryCode('user-2', code), false);
    // Unknown code fails.
    assert.equal(await svc.useRecoveryCode('user-2', 'ffff-ffff-ff'), false);
  });

  it('disable removes MFA', async () => {
    const pool = new FakeMfaPool();
    const svc = new MfaService(pool);
    const { secret } = await svc.beginEnrollment('user-3', 'carol');
    await svc.confirmEnrollment('user-3', totp(base32Decode(secret)));
    await svc.disable('user-3');
    assert.equal(await svc.isEnabled('user-3'), false);
  });
});
