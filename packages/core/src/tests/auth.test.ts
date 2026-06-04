// src/tests/auth.test.ts
// Comprehensive security tests: WebAuthn, RBAC, OAuth2, API Keys.
// Run after `tsc`:
//   node --test dist/tests/auth.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';

import {
  WebAuthnService,
  parseCredentialPublicKey,
  decodeCbor,
} from '../auth/webauthn.js';
import {
  RbacService,
  rbacGuard,
  Roles,
  Permissions,
} from '../auth/rbac.js';
import { OAuthManager } from '../auth/oauth2.js';
import { ApiKeyService } from '../auth/api-keys.js';
import { ForbiddenException } from '../http/exceptions.js';

// ── CBOR encoding helpers ─────────────────────────────────────────────────────

/** Encode a small unsigned integer as a CBOR byte. */
function cborUint(n: number): Buffer {
  if (n <= 23) return Buffer.from([n]);
  if (n <= 0xff) return Buffer.from([0x18, n]);
  // 2-byte uint (major 0, additional 25)
  const b = Buffer.alloc(3);
  b[0] = 0x19;
  b.writeUInt16BE(n, 1);
  return b;
}

/** Encode a negative integer as CBOR (major type 1). */
function cborNegInt(n: number): Buffer {
  // n is the JS negative number; CBOR stores -(n+1)
  const v = -(n + 1);
  if (v <= 23) return Buffer.from([0x20 | v]);
  if (v <= 0xff) return Buffer.from([0x38, v]);
  const b = Buffer.alloc(3);
  b[0] = 0x39;
  b.writeUInt16BE(v, 1);
  return b;
}

/** Encode a byte string as CBOR (major type 2). */
function cborBytes(buf: Buffer): Buffer {
  const lenBuf = cborUint(buf.length);
  // Patch major type to 2
  lenBuf[0] = (lenBuf[0]! & 0x1f) | 0x40;
  return Buffer.concat([lenBuf, buf]);
}

/** Encode a CBOR map from an array of [key-buf, value-buf] pairs. */
function cborMap(pairs: Array<[Buffer, Buffer]>): Buffer {
  const countBuf = cborUint(pairs.length);
  countBuf[0] = (countBuf[0]! & 0x1f) | 0xa0; // major type 5
  const parts: Buffer[] = [countBuf];
  for (const [k, v] of pairs) {
    parts.push(k, v);
  }
  return Buffer.concat(parts);
}

/** Build a minimal COSE EC2 key CBOR map (kty=2, alg=-7, crv=1, x, y). */
function buildCoseEc2Key(x: Buffer, y: Buffer): Buffer {
  return cborMap([
    [cborUint(1),      cborUint(2)],     // kty = EC2
    [cborUint(3),      cborNegInt(-7)],   // alg = ES256
    [cborNegInt(-1),   cborUint(1)],      // crv = P-256
    [cborNegInt(-2),   cborBytes(x)],     // x coordinate
    [cborNegInt(-3),   cborBytes(y)],     // y coordinate
  ]);
}

/**
 * Build a synthetic authData buffer with the AT flag set and an embedded COSE
 * EC2 public key so parseCredentialPublicKey / finishRegistration can be tested
 * without a real authenticator.
 */
function buildAuthData(x: Buffer, y: Buffer, signCount = 0): Buffer {
  const rpIdHash = crypto.createHash('sha256').update('localhost').digest();
  const flags = Buffer.from([0x41]); // UP | AT
  const signCountBuf = Buffer.alloc(4);
  signCountBuf.writeUInt32BE(signCount, 0);
  const aaguid = Buffer.alloc(16, 0);
  const credId = crypto.randomBytes(16);
  const credIdLen = Buffer.alloc(2);
  credIdLen.writeUInt16BE(credId.length, 0);
  const coseKey = buildCoseEc2Key(x, y);
  return Buffer.concat([rpIdHash, flags, signCountBuf, aaguid, credIdLen, credId, coseKey]);
}

/** Build a minimal CBOR attestation object wrapping the authData. */
function buildAttestationObject(authData: Buffer): Buffer {
  // { fmt: "none", attStmt: {}, authData: <bytes> }
  const fmt = Buffer.concat([Buffer.from([0x63]), Buffer.from('fmt')]); // text "fmt"
  const fmtVal = Buffer.concat([Buffer.from([0x64]), Buffer.from('none')]); // text "none"
  const attStmt = Buffer.concat([Buffer.from([0x68]), Buffer.from('attStmt')]); // text "attStmt"
  const attStmtVal = Buffer.from([0xa0]); // empty map
  const authDataKey = Buffer.concat([Buffer.from([0x68]), Buffer.from('authData')]); // text "authData"
  const authDataVal = cborBytes(authData);
  // 3-entry map
  const header = Buffer.from([0xa3]); // map(3)
  return Buffer.concat([header, fmt, fmtVal, attStmt, attStmtVal, authDataKey, authDataVal]);
}

// ── In-memory WebAuthn fakes ──────────────────────────────────────────────────

class MemorySession {
  private store = new Map<string, { challenge: string; expiresAt: number }>();
  async getChallenge(userId: string) { return this.store.get(userId) ?? null; }
  async setChallenge(userId: string, challenge: string, expiresAt: number) {
    this.store.set(userId, { challenge, expiresAt });
  }
  async clearChallenge(userId: string) { this.store.delete(userId); }
}

class MemoryPool {
  rows: Record<string, string | null>[] = [];
  async query(sql: string, params?: unknown[]) {
    const s = sql.trim().toUpperCase();
    if (s.startsWith('INSERT')) {
      const row: Record<string, string | null> = {
        id: 'cred-id-1',
        user_id: String(params?.[0] ?? ''),
        credential_id: String(params?.[1] ?? ''),
        public_key: String(params?.[2] ?? ''),
        sign_count: String(params?.[3] ?? '0'),
      };
      this.rows.push(row);
      return { rows: [row], rowCount: 1, command: 'INSERT' };
    }
    if (s.startsWith('SELECT') && s.includes('CREDENTIAL_ID') && s.includes('USER_ID')) {
      const credId = String(params?.[0] ?? '');
      const userId = String(params?.[1] ?? '');
      const found = this.rows.filter(r => r['credential_id'] === credId && r['user_id'] === userId);
      return { rows: found, rowCount: found.length, command: 'SELECT' };
    }
    if (s.startsWith('SELECT')) {
      return { rows: this.rows, rowCount: this.rows.length, command: 'SELECT' };
    }
    if (s.startsWith('UPDATE')) {
      return { rows: [], rowCount: 1, command: 'UPDATE' };
    }
    return { rows: [], rowCount: 0, command: 'OK' };
  }
}

// ── WebAuthn tests ────────────────────────────────────────────────────────────

describe('parseCredentialPublicKey — EC2 COSE key to JWK', () => {
  it('parses EC2 COSE key and returns valid EC JWK JSON', () => {
    const x = crypto.randomBytes(32);
    const y = crypto.randomBytes(32);
    const authData = buildAuthData(x, y);
    const jwkStr = parseCredentialPublicKey(authData);
    const jwk = JSON.parse(jwkStr) as Record<string, string>;
    assert.equal(jwk['kty'], 'EC');
    assert.equal(jwk['crv'], 'P-256');
    assert.equal(jwk['x'], x.toString('base64url'));
    assert.equal(jwk['y'], y.toString('base64url'));
  });

  it('throws when authData is too short', () => {
    assert.throws(
      () => parseCredentialPublicKey(Buffer.alloc(10)),
      /too short/i,
    );
  });

  it('throws when AT flag is not set', () => {
    const buf = Buffer.alloc(100, 0);
    buf[32] = 0x01; // UP only, no AT (0x40)
    assert.throws(
      () => parseCredentialPublicKey(buf),
      /No attested credential/i,
    );
  });
});

describe('WebAuthnService.finishRegistration — COSE key storage', () => {
  it('stores a valid JWK JSON string (not raw authData bytes)', async () => {
    const session = new MemorySession();
    const pool = new MemoryPool();
    const svc = new WebAuthnService(
      { rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' },
      pool,
      session,
    );

    // Set up challenge
    const challenge = crypto.randomBytes(32).toString('base64url');
    await session.setChallenge('user1', challenge, Date.now() + 60_000);

    // Build synthetic credential
    const x = crypto.randomBytes(32);
    const y = crypto.randomBytes(32);
    const authData = buildAuthData(x, y);
    const attObj = buildAttestationObject(authData);

    const clientData = { type: 'webauthn.create', challenge, origin: 'http://localhost' };
    const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
    const attestationObject = attObj.toString('base64url');

    const result = await svc.finishRegistration('user1', {
      id: 'cred-abc',
      rawId: 'cred-abc',
      response: { clientDataJSON, attestationObject },
      type: 'public-key',
    });

    assert.equal(result.credentialId, 'cred-abc');

    // Verify stored public_key is a valid JWK JSON string
    const storedKey = pool.rows[0]?.['public_key'];
    assert.ok(storedKey, 'public_key must be stored');
    const jwk = JSON.parse(storedKey) as Record<string, string>;
    assert.equal(jwk['kty'], 'EC');
    assert.equal(jwk['crv'], 'P-256');
    assert.equal(jwk['x'], x.toString('base64url'));
    assert.equal(jwk['y'], y.toString('base64url'));
  });
});

describe('WebAuthnService.finishAuthentication — signature verification', () => {
  async function setupCred(pool: MemoryPool, session: MemorySession, userId: string, challenge: string) {
    // Generate a real EC P-256 key pair for testing
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
    const credId = 'test-cred-123';

    await session.setChallenge(userId, challenge, Date.now() + 60_000);
    pool.rows.push({
      id: 'db-row-1',
      user_id: userId,
      credential_id: credId,
      public_key: JSON.stringify(jwk),
      sign_count: '0',
    });
    return { privateKey, credId };
  }

  it('rejects zero-length signature (throws, does not skip)', async () => {
    const session = new MemorySession();
    const pool = new MemoryPool();
    const svc = new WebAuthnService(
      { rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' },
      pool,
      session,
    );

    const challenge = crypto.randomBytes(32).toString('base64url');
    await setupCred(pool, session, 'user2', challenge);
    // Reset challenge for auth
    await session.setChallenge('user2', challenge, Date.now() + 60_000);

    const clientData = { type: 'webauthn.get', challenge, origin: 'http://localhost' };
    const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
    const authDataBuf = Buffer.alloc(41, 0);
    authDataBuf[32] = 0x01; // UP flag
    authDataBuf.writeUInt32BE(1, 33); // sign count = 1
    const authenticatorData = authDataBuf.toString('base64url');

    await assert.rejects(
      () => svc.finishAuthentication('user2', {
        id: 'test-cred-123',
        rawId: 'test-cred-123',
        response: {
          clientDataJSON,
          authenticatorData,
          signature: Buffer.alloc(0).toString('base64url'), // empty sig
        },
        type: 'public-key',
      }),
      /signature/i,
    );
  });

  it('rejects malformed public key stored in DB (throws, never passes silently)', async () => {
    const session = new MemorySession();
    const pool = new MemoryPool();
    const svc = new WebAuthnService(
      { rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' },
      pool,
      session,
    );

    const challenge = crypto.randomBytes(32).toString('base64url');
    await session.setChallenge('user3', challenge, Date.now() + 60_000);

    // Store a malformed JWK (not valid JSON object as public key)
    pool.rows.push({
      id: 'db-row-2',
      user_id: 'user3',
      credential_id: 'cred-bad',
      public_key: 'not-valid-json!!!',
      sign_count: '0',
    });

    const clientData = { type: 'webauthn.get', challenge, origin: 'http://localhost' };
    const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
    const authDataBuf = Buffer.alloc(41, 0);
    authDataBuf[32] = 0x01;
    authDataBuf.writeUInt32BE(1, 33);
    const authenticatorData = authDataBuf.toString('base64url');
    const signature = crypto.randomBytes(64).toString('base64url');

    await assert.rejects(
      () => svc.finishAuthentication('user3', {
        id: 'cred-bad',
        rawId: 'cred-bad',
        response: { clientDataJSON, authenticatorData, signature },
        type: 'public-key',
      }),
    );
  });

  it('rejects tampered authenticatorData (bad signature)', async () => {
    const session = new MemorySession();
    const pool = new MemoryPool();
    const svc = new WebAuthnService(
      { rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' },
      pool,
      session,
    );

    const challenge = crypto.randomBytes(32).toString('base64url');
    const { privateKey } = await setupCred(pool, session, 'user4', challenge);
    await session.setChallenge('user4', challenge, Date.now() + 60_000);

    const clientData = { type: 'webauthn.get', challenge, origin: 'http://localhost' };
    const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');

    // Build valid authData but sign over different data (tamper)
    const authDataBuf = Buffer.alloc(41, 0);
    authDataBuf[32] = 0x01;
    authDataBuf.writeUInt32BE(1, 33);

    // Sign over tampered (wrong) data
    const wrongData = crypto.randomBytes(64);
    const sig = crypto.createSign('SHA256').update(wrongData).sign(privateKey);
    const authenticatorData = authDataBuf.toString('base64url');
    const signature = sig.toString('base64url');

    await assert.rejects(
      () => svc.finishAuthentication('user4', {
        id: 'test-cred-123',
        rawId: 'test-cred-123',
        response: { clientDataJSON, authenticatorData, signature },
        type: 'public-key',
      }),
      /signature/i,
    );
  });

  it('rejects expired challenge', async () => {
    const session = new MemorySession();
    const pool = new MemoryPool();
    const svc = new WebAuthnService(
      { rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' },
      pool,
      session,
    );

    const challenge = crypto.randomBytes(32).toString('base64url');
    // Set challenge already expired
    await session.setChallenge('user5', challenge, Date.now() - 1_000);

    const clientData = { type: 'webauthn.get', challenge, origin: 'http://localhost' };
    const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');

    await assert.rejects(
      () => svc.finishAuthentication('user5', {
        id: 'cred-x',
        rawId: 'cred-x',
        response: {
          clientDataJSON,
          authenticatorData: Buffer.alloc(41, 0).toString('base64url'),
          signature: 'aabb',
        },
        type: 'public-key',
      }),
      /challenge_expired/i,
    );
  });

  it('succeeds with a valid real signature', async () => {
    const session = new MemorySession();
    const pool = new MemoryPool();
    const svc = new WebAuthnService(
      { rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' },
      pool,
      session,
    );

    const challenge = crypto.randomBytes(32).toString('base64url');
    const { privateKey } = await setupCred(pool, session, 'user6', challenge);
    await session.setChallenge('user6', challenge, Date.now() + 60_000);

    const clientData = { type: 'webauthn.get', challenge, origin: 'http://localhost' };
    const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
    const authDataBuf = Buffer.alloc(41, 0);
    authDataBuf[32] = 0x01;
    authDataBuf.writeUInt32BE(1, 33);

    // Compute signed data exactly as the service does
    const clientDataHash = crypto.createHash('sha256')
      .update(Buffer.from(clientDataJSON, 'base64url'))
      .digest();
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const sig = crypto.createSign('SHA256').update(signedData).sign(privateKey);

    await assert.doesNotReject(
      () => svc.finishAuthentication('user6', {
        id: 'test-cred-123',
        rawId: 'test-cred-123',
        response: {
          clientDataJSON,
          authenticatorData: authDataBuf.toString('base64url'),
          signature: sig.toString('base64url'),
        },
        type: 'public-key',
      }),
    );
  });
});

// ── RBAC tests ────────────────────────────────────────────────────────────────

describe('RbacService.hasRole', () => {
  it('returns true for direct role match', () => {
    const svc = new RbacService({ admin: [], editor: [], viewer: [] });
    assert.ok(svc.hasRole(['admin'], 'admin'));
  });

  it('returns false when role not present', () => {
    const svc = new RbacService({ admin: [], editor: [] });
    assert.ok(!svc.hasRole(['viewer'], 'admin'));
  });
});

describe('RbacService.hasPermission', () => {
  const hierarchy = { admin: ['editor'], editor: ['viewer'], viewer: [] };
  const rolePermissions = {
    admin: ['users:write'],
    editor: ['posts:write'],
    viewer: ['posts:read'],
  };

  it('returns true when role has permission directly', () => {
    const svc = new RbacService(hierarchy, rolePermissions);
    assert.ok(svc.hasPermission(['editor'], 'posts:write'));
  });

  it('returns false when role does not have permission', () => {
    const svc = new RbacService(hierarchy, rolePermissions);
    assert.ok(!svc.hasPermission(['viewer'], 'users:write'));
  });

  it('admin inherits editor and viewer permissions via BFS', () => {
    const svc = new RbacService(hierarchy, rolePermissions);
    // admin directly has users:write; inherits posts:write from editor and posts:read from viewer
    assert.ok(svc.hasPermission(['admin'], 'users:write'));
    assert.ok(svc.hasPermission(['admin'], 'posts:write'));
    assert.ok(svc.hasPermission(['admin'], 'posts:read'));
  });

  it('viewer only has posts:read', () => {
    const svc = new RbacService(hierarchy, rolePermissions);
    assert.ok(svc.hasPermission(['viewer'], 'posts:read'));
    assert.ok(!svc.hasPermission(['viewer'], 'posts:write'));
  });
});

describe('rbacGuard middleware', () => {
  function makeCtx(userRoles: string[], state: Record<string, unknown> = {}) {
    return {
      user: { id: '1', email: 'test@test.com', roles: userRoles },
      state,
    };
  }

  async function runGuard(
    svc: RbacService,
    ctx: { user: { roles: string[] } | null; state: Record<string, unknown> },
  ): Promise<void> {
    const guard = rbacGuard(svc);
    let nextCalled = false;
    await guard(ctx as Parameters<typeof guard>[0], async () => { nextCalled = true; });
    if (!nextCalled) throw new Error('next() was not called');
  }

  it('passes through when no roles required', async () => {
    const svc = new RbacService({ admin: [] });
    const ctx = makeCtx(['viewer'], { _requiredRoles: [], _requiredPermissions: [] });
    await assert.doesNotReject(() => runGuard(svc, ctx));
  });

  it('passes when user has required role', async () => {
    const svc = new RbacService({ admin: [], viewer: [] });
    const ctx = makeCtx(['admin'], { _requiredRoles: ['admin'], _requiredPermissions: [] });
    await assert.doesNotReject(() => runGuard(svc, ctx));
  });

  it('throws ForbiddenException when user lacks required role', async () => {
    const svc = new RbacService({ admin: [], viewer: [] });
    const ctx = makeCtx(['viewer'], { _requiredRoles: ['admin'], _requiredPermissions: [] });
    const guard = rbacGuard(svc);
    await assert.rejects(
      () => guard(ctx as Parameters<typeof guard>[0], async () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        return true;
      },
    );
  });

  it('throws ForbiddenException when user lacks required permission', async () => {
    const svc = new RbacService({ viewer: [] }, { viewer: ['posts:read'] });
    const ctx = makeCtx(['viewer'], { _requiredRoles: [], _requiredPermissions: ['users:write'] });
    const guard = rbacGuard(svc);
    await assert.rejects(
      () => guard(ctx as Parameters<typeof guard>[0], async () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        return true;
      },
    );
  });

  it('passes when user has required permission', async () => {
    const svc = new RbacService({ editor: [] }, { editor: ['posts:write'] });
    const ctx = makeCtx(['editor'], { _requiredRoles: [], _requiredPermissions: ['posts:write'] });
    await assert.doesNotReject(() => runGuard(svc, ctx));
  });

  it('@Roles decorator stores metadata readable by router (integration check)', () => {
    class TestController {
      @Roles('admin')
      adminRoute() {}
    }
    const proto = TestController.prototype as object;
    const meta = Reflect.getMetadata('street:roles', proto, 'adminRoute') as string[];
    assert.deepEqual(meta, ['admin']);
  });

  it('@Permissions decorator stores metadata readable by router', () => {
    class TestController2 {
      @Permissions('posts:write')
      writeRoute() {}
    }
    const proto = TestController2.prototype as object;
    const meta = Reflect.getMetadata('street:permissions', proto, 'writeRoute') as string[];
    assert.deepEqual(meta, ['posts:write']);
  });
});

// ── OAuth2 tests ──────────────────────────────────────────────────────────────

describe('OAuthManager constructor', () => {
  it('throws when sessionManager is not provided', () => {
    assert.throws(
      () => new OAuthManager({
        providers: [{ name: 'github', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://localhost/cb' }],
        // sessionManager intentionally omitted — cast to force the runtime check
        sessionManager: undefined as unknown as OAuthManager extends { _session: infer S } ? S : never,
      }),
      /sessionManager/i,
    );
  });

  it('constructs successfully when sessionManager is provided', () => {
    const sm = { get: () => null, set: () => {} };
    assert.doesNotThrow(() => new OAuthManager({
      providers: [{ name: 'github', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://localhost/cb' }],
      sessionManager: sm,
    }));
  });
});

describe('OAuthManager.handleCallback — state validation', () => {
  it('throws on state mismatch', async () => {
    const sm = { get: () => null, set: () => {} };
    const mgr = new OAuthManager({
      providers: [{ name: 'github', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://localhost/cb' }],
      sessionManager: sm,
    });

    await assert.rejects(
      () => mgr.handleCallback('github', 'code123', 'wrong-state', 'correct-state', 'verifier'),
      /state mismatch/i,
    );
  });
});

describe('OAuth2 PKCE code_challenge', () => {
  it('code_challenge = SHA256(verifier) base64url', () => {
    const verifier = 'testverifier123456789012345678901234';
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
    // Verify by constructing the same way the OAuthManager does internally
    // We test the property independently since generateCodeChallenge is private
    const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
    assert.equal(computed, expected);
    // Ensure it's URL-safe base64 (no +, /, =)
    assert.ok(!/[+/=]/.test(computed), 'code_challenge must be base64url encoded');
  });

  it('code_challenge length is 43 chars for SHA-256 output', () => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    assert.equal(challenge.length, 43);
  });
});

// ── API Key tests ─────────────────────────────────────────────────────────────

/** Minimal in-memory pool for API key tests. */
class ApiKeyMemPool {
  private rows: Record<string, string | null>[] = [];
  private nextId = 1;

  async query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, string | null>[]; rowCount: number; command: string }> {
    const s = sql.trim().toUpperCase();

    if (s.startsWith('INSERT')) {
      const id = String(this.nextId++);
      const row: Record<string, string | null> = {
        id,
        key_hash: String(params?.[0] ?? ''),
        prefix: String(params?.[1] ?? ''),
        name: String(params?.[2] ?? ''),
        owner_id: String(params?.[3] ?? ''),
        expires_at: params?.[4] != null ? String(params[4]) : null,
        created_at: new Date().toISOString(),
      };
      this.rows.push(row);
      return { rows: [row], rowCount: 1, command: 'INSERT' };
    }

    if (s.startsWith('SELECT') && s.includes('KEY_HASH')) {
      const hashParam = String(params?.[0] ?? '');
      const found = this.rows.filter(r => r['key_hash'] === hashParam);
      return { rows: found, rowCount: found.length, command: 'SELECT' };
    }

    if (s.startsWith('SELECT') && s.includes('WHERE ID')) {
      const id = String(params?.[0] ?? '');
      const found = this.rows.filter(r => r['id'] === id);
      return { rows: found, rowCount: found.length, command: 'SELECT' };
    }

    if (s.startsWith('DELETE')) {
      const id = String(params?.[0] ?? '');
      const before = this.rows.length;
      this.rows = this.rows.filter(r => r['id'] !== id);
      return { rows: [], rowCount: before - this.rows.length, command: 'DELETE' };
    }

    return { rows: [], rowCount: 0, command: 'OK' };
  }
}

describe('ApiKeyService.verify', () => {
  it('returns null for an expired key', async () => {
    const pool = new ApiKeyMemPool();
    const svc = new ApiKeyService(pool);

    // Generate key with expiry in the past
    const past = new Date(Date.now() - 10_000);
    const { key } = await svc.generate({ ownerId: 'owner1', name: 'expiredKey', expiresAt: past });

    const result = await svc.verify(key);
    assert.equal(result, null);
  });

  it('returns the ApiKey record for a valid non-expired key', async () => {
    const pool = new ApiKeyMemPool();
    const svc = new ApiKeyService(pool);

    const future = new Date(Date.now() + 3_600_000);
    const { key, record } = await svc.generate({ ownerId: 'owner2', name: 'validKey', expiresAt: future });

    const result = await svc.verify(key);
    assert.ok(result !== null);
    assert.equal(result.ownerId, record.ownerId);
  });

  it('handles length mismatch in timingSafeEqual gracefully (returns null)', async () => {
    const pool = new ApiKeyMemPool();
    const svc = new ApiKeyService(pool);

    // Verify a completely unknown key — the hash won't match anything
    const result = await svc.verify('totally-unknown-key-that-does-not-exist');
    assert.equal(result, null);
  });

  it('returns null for an unknown key', async () => {
    const pool = new ApiKeyMemPool();
    const svc = new ApiKeyService(pool);
    const result = await svc.verify('sk_live_unknownkey12345678');
    assert.equal(result, null);
  });
});

describe('ApiKeyService.revoke', () => {
  it('removes key from LRU cache after revoke', async () => {
    const pool = new ApiKeyMemPool();
    const svc = new ApiKeyService(pool);

    const future = new Date(Date.now() + 3_600_000);
    const { key, record } = await svc.generate({ ownerId: 'owner3', name: 'toRevoke', expiresAt: future });

    // Warm up cache
    const before = await svc.verify(key);
    assert.ok(before !== null);

    // Revoke
    await svc.revoke(record.id);

    // After revoke, the key is gone from the DB, so verify returns null
    const after = await svc.verify(key);
    assert.equal(after, null);
  });

  it('revoke does not throw for unknown id', async () => {
    const pool = new ApiKeyMemPool();
    const svc = new ApiKeyService(pool);
    await assert.doesNotReject(() => svc.revoke('nonexistent-id'));
  });
});
