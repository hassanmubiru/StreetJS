// src/auth/mfa.ts
// TOTP (RFC 6238) multi-factor authentication with recovery codes.
// Pure node:crypto — no third-party dependencies. The TOTP implementation is
// validated against the RFC 6238 Appendix B reference test vectors.

import { createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

// ── Base32 (RFC 4648, no padding) ───────────────────────────────────────────────

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode a buffer as RFC 4648 base32 (no padding) — used for otpauth secrets. */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode an RFC 4648 base32 string (padding/whitespace tolerated). */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── HOTP / TOTP ─────────────────────────────────────────────────────────────────

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpOptions {
  digits?: number;      // default 6
  periodSec?: number;   // default 30
  algorithm?: TotpAlgorithm; // default SHA1 (most authenticator apps)
}

/** RFC 4226 HOTP: HMAC-based one-time password for an explicit counter. */
export function hotp(secret: Buffer, counter: bigint, opts: TotpOptions = {}): string {
  const digits = opts.digits ?? 6;
  const algo = (opts.algorithm ?? 'SHA1').toLowerCase();
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter);
  const hmac = createHmac(algo, secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** RFC 6238 TOTP for a given time (ms since epoch; defaults to now). */
export function totp(secret: Buffer, opts: TotpOptions = {}, nowMs: number = Date.now()): string {
  const period = opts.periodSec ?? 30;
  const counter = BigInt(Math.floor(nowMs / 1000 / period));
  return hotp(secret, counter, opts);
}

/**
 * Verify a user-supplied TOTP code, accepting codes within ±`window` periods to
 * tolerate clock skew. Comparison is constant-time. Returns true on match.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  opts: TotpOptions & { window?: number } = {},
  nowMs: number = Date.now(),
): boolean {
  const window = opts.window ?? 1;
  const period = opts.periodSec ?? 30;
  const digits = opts.digits ?? 6;
  const candidate = code.trim();
  if (!/^\d+$/.test(candidate) || candidate.length !== digits) return false;
  const counter = Math.floor(nowMs / 1000 / period);
  for (let w = -window; w <= window; w++) {
    const expected = hotp(secret, BigInt(counter + w), opts);
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

// ── MFA enrollment service ────────────────────────────────────────────────────

export const MFA_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS street_mfa (
  user_id TEXT PRIMARY KEY,
  secret_b32 TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_hashes JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);`;

export interface MfaPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

export interface EnrollmentResult {
  secret: string;        // base32 secret to show once
  otpauthUrl: string;    // provisioning URI for QR codes
  recoveryCodes: string[]; // plaintext, shown once
}

function hashCode(code: string): string {
  return createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');
}

/** Generate `count` human-friendly recovery codes (e.g. `a1b2-c3d4-e5`). */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(5).toString('hex'); // 10 hex chars
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 10)}`);
  }
  return codes;
}

/**
 * MFA enrollment + verification backed by a SQL table. Secrets are stored as
 * base32; recovery codes are stored only as SHA-256 hashes and are single-use.
 */
export class MfaService {
  constructor(
    private readonly pool: MfaPool,
    private readonly opts: { issuer?: string; totp?: TotpOptions } = {},
  ) {}

  /** Begin enrollment: generate a secret + recovery codes, store (disabled). */
  async beginEnrollment(userId: string, accountName: string): Promise<EnrollmentResult> {
    const secretBuf = randomBytes(20);
    const secret = base32Encode(secretBuf);
    const recoveryCodes = generateRecoveryCodes();
    const hashes = recoveryCodes.map(hashCode);
    await this.pool.query(
      `INSERT INTO street_mfa (user_id, secret_b32, enabled, recovery_hashes)
       VALUES ($1, $2, FALSE, $3)
       ON CONFLICT (user_id) DO UPDATE SET secret_b32 = EXCLUDED.secret_b32, enabled = FALSE, recovery_hashes = EXCLUDED.recovery_hashes`,
      [userId, secret, JSON.stringify(hashes)],
    );
    const issuer = encodeURIComponent(this.opts.issuer ?? 'Street');
    const label = encodeURIComponent(accountName);
    const algo = this.opts.totp?.algorithm ?? 'SHA1';
    const digits = this.opts.totp?.digits ?? 6;
    const period = this.opts.totp?.periodSec ?? 30;
    const otpauthUrl = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=${algo}&digits=${digits}&period=${period}`;
    return { secret, otpauthUrl, recoveryCodes };
  }

  /** Confirm enrollment by verifying the first code; enables MFA on success. */
  async confirmEnrollment(userId: string, code: string): Promise<boolean> {
    const row = await this._row(userId);
    if (!row) return false;
    const secret = base32Decode(row.secret_b32);
    if (!verifyTotp(secret, code, this.opts.totp)) return false;
    await this.pool.query(
      `UPDATE street_mfa SET enabled = TRUE, confirmed_at = NOW() WHERE user_id = $1`,
      [userId],
    );
    return true;
  }

  /** Whether MFA is enabled for a user. */
  async isEnabled(userId: string): Promise<boolean> {
    const row = await this._row(userId);
    return row?.enabled === true;
  }

  /** Verify a TOTP code for an enabled user. */
  async verify(userId: string, code: string): Promise<boolean> {
    const row = await this._row(userId);
    if (!row || !row.enabled) return false;
    return verifyTotp(base32Decode(row.secret_b32), code, this.opts.totp);
  }

  /**
   * Consume a single-use recovery code. Returns true and removes the code's hash
   * on success; false if the code is unknown/already used.
   */
  async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    const row = await this._row(userId);
    if (!row || !row.enabled) return false;
    const target = hashCode(code);
    const idx = row.recovery_hashes.findIndex((h) => {
      const a = Buffer.from(h);
      const b = Buffer.from(target);
      return a.length === b.length && timingSafeEqual(a, b);
    });
    if (idx === -1) return false;
    const remaining = row.recovery_hashes.slice();
    remaining.splice(idx, 1);
    await this.pool.query(
      `UPDATE street_mfa SET recovery_hashes = $2 WHERE user_id = $1`,
      [userId, JSON.stringify(remaining)],
    );
    return true;
  }

  /** Disable and remove MFA for a user. */
  async disable(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM street_mfa WHERE user_id = $1`, [userId]);
  }

  private async _row(userId: string): Promise<{ secret_b32: string; enabled: boolean; recovery_hashes: string[] } | null> {
    const res = await this.pool.query(
      `SELECT secret_b32, enabled, recovery_hashes FROM street_mfa WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    const row = res.rows[0];
    if (!row) return null;
    const rh = row['recovery_hashes'];
    return {
      secret_b32: String(row['secret_b32']),
      enabled: row['enabled'] === true || row['enabled'] === 't',
      recovery_hashes: Array.isArray(rh) ? (rh as string[]) : JSON.parse(String(rh ?? '[]')) as string[],
    };
  }
}

// ── MFA middleware (step-up authentication) ─────────────────────────────────────

interface MfaContext {
  user: { id?: string } | null;
  state: Record<string, unknown>;
  json(data: unknown, status?: number): void;
}

export interface MfaGuardOptions {
  /**
   * Key in `ctx.state` that marks the current session as having completed MFA
   * for this request (set it after a successful step-up verification). Default
   * `'mfaVerified'`.
   */
  verifiedStateKey?: string;
}

/**
 * Step-up MFA guard. For an authenticated user who has MFA enabled, the request
 * is allowed only when the session is marked MFA-verified; otherwise it responds
 * `403 { error: 'mfa_required' }` so the client can prompt for a code. Users
 * without MFA enabled, and unauthenticated requests, pass through unchanged
 * (pair with an auth guard upstream).
 */
export function mfaGuard(service: MfaService, opts: MfaGuardOptions = {}) {
  const key = opts.verifiedStateKey ?? 'mfaVerified';
  return async (ctx: MfaContext, next: () => Promise<void>): Promise<void> => {
    const userId = ctx.user?.id;
    if (!userId) { await next(); return; }
    if (ctx.state[key] === true) { await next(); return; }
    if (!(await service.isEnabled(userId))) { await next(); return; }
    ctx.json({ error: 'mfa_required', methods: ['totp', 'recovery_code'] }, 403);
  };
}

/**
 * Verify a step-up challenge: accepts a TOTP code or a single-use recovery code.
 * On success, marks `ctx.state[verifiedStateKey] = true`. Returns the outcome so
 * callers can issue an MFA-elevated session token.
 */
export async function verifyMfaStepUp(
  service: MfaService,
  userId: string,
  code: string,
  ctx?: MfaContext,
  opts: MfaGuardOptions = {},
): Promise<{ ok: boolean; method?: 'totp' | 'recovery_code' }> {
  if (await service.verify(userId, code)) {
    if (ctx) ctx.state[opts.verifiedStateKey ?? 'mfaVerified'] = true;
    return { ok: true, method: 'totp' };
  }
  if (await service.useRecoveryCode(userId, code)) {
    if (ctx) ctx.state[opts.verifiedStateKey ?? 'mfaVerified'] = true;
    return { ok: true, method: 'recovery_code' };
  }
  return { ok: false };
}
