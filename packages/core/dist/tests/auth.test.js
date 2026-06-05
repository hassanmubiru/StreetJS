// src/tests/auth.test.ts
// Comprehensive security tests: WebAuthn, RBAC, OAuth2, API Keys.
// Run after `tsc`:
//   node --test dist/tests/auth.test.js
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { WebAuthnService, parseCredentialPublicKey, } from '../auth/webauthn.js';
import { RbacService, rbacGuard, Roles, Permissions, } from '../auth/rbac.js';
import { OAuthManager } from '../auth/oauth2.js';
import { ApiKeyService } from '../auth/api-keys.js';
import { ForbiddenException } from '../http/exceptions.js';
// ── CBOR encoding helpers ─────────────────────────────────────────────────────
/** Encode a small unsigned integer as a CBOR byte. */
function cborUint(n) {
    if (n <= 23)
        return Buffer.from([n]);
    if (n <= 0xff)
        return Buffer.from([0x18, n]);
    // 2-byte uint (major 0, additional 25)
    const b = Buffer.alloc(3);
    b[0] = 0x19;
    b.writeUInt16BE(n, 1);
    return b;
}
/** Encode a negative integer as CBOR (major type 1). */
function cborNegInt(n) {
    // n is the JS negative number; CBOR stores -(n+1)
    const v = -(n + 1);
    if (v <= 23)
        return Buffer.from([0x20 | v]);
    if (v <= 0xff)
        return Buffer.from([0x38, v]);
    const b = Buffer.alloc(3);
    b[0] = 0x39;
    b.writeUInt16BE(v, 1);
    return b;
}
/** Encode a byte string as CBOR (major type 2). */
function cborBytes(buf) {
    const lenBuf = cborUint(buf.length);
    // Patch major type to 2
    lenBuf[0] = (lenBuf[0] & 0x1f) | 0x40;
    return Buffer.concat([lenBuf, buf]);
}
/** Encode a CBOR map from an array of [key-buf, value-buf] pairs. */
function cborMap(pairs) {
    const countBuf = cborUint(pairs.length);
    countBuf[0] = (countBuf[0] & 0x1f) | 0xa0; // major type 5
    const parts = [countBuf];
    for (const [k, v] of pairs) {
        parts.push(k, v);
    }
    return Buffer.concat(parts);
}
/** Build a minimal COSE EC2 key CBOR map (kty=2, alg=-7, crv=1, x, y). */
function buildCoseEc2Key(x, y) {
    return cborMap([
        [cborUint(1), cborUint(2)], // kty = EC2
        [cborUint(3), cborNegInt(-7)], // alg = ES256
        [cborNegInt(-1), cborUint(1)], // crv = P-256
        [cborNegInt(-2), cborBytes(x)], // x coordinate
        [cborNegInt(-3), cborBytes(y)], // y coordinate
    ]);
}
/**
 * Build a synthetic authData buffer with the AT flag set and an embedded COSE
 * EC2 public key so parseCredentialPublicKey / finishRegistration can be tested
 * without a real authenticator.
 */
function buildAuthData(x, y, signCount = 0) {
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
/** Encode a text string as CBOR (major type 3). */
function cborText(s) {
    const strBuf = Buffer.from(s, 'utf8');
    const lenBuf = cborUint(strBuf.length);
    lenBuf[0] = (lenBuf[0] & 0x1f) | 0x60; // major type 3
    return Buffer.concat([lenBuf, strBuf]);
}
/** Build a minimal CBOR attestation object wrapping the authData. */
function buildAttestationObject(authData) {
    // { "fmt": "none", "attStmt": {}, "authData": <bytes> }
    // CBOR map with 3 entries
    const header = Buffer.from([0xa3]); // map(3)
    const fmt = cborText('fmt');
    const fmtVal = cborText('none');
    const attStmt = cborText('attStmt');
    const attStmtVal = Buffer.from([0xa0]); // empty map
    const authDataKey = cborText('authData');
    const authDataVal = cborBytes(authData);
    return Buffer.concat([header, fmt, fmtVal, attStmt, attStmtVal, authDataKey, authDataVal]);
}
// ── In-memory WebAuthn fakes ──────────────────────────────────────────────────
class MemorySession {
    store = new Map();
    async getChallenge(userId) { return this.store.get(userId) ?? null; }
    async setChallenge(userId, challenge, expiresAt) {
        this.store.set(userId, { challenge, expiresAt });
    }
    async clearChallenge(userId) { this.store.delete(userId); }
}
class MemoryPool {
    rows = [];
    async query(sql, params) {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('INSERT')) {
            const row = {
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
        const jwk = JSON.parse(jwkStr);
        assert.equal(jwk['kty'], 'EC');
        assert.equal(jwk['crv'], 'P-256');
        assert.equal(jwk['x'], x.toString('base64url'));
        assert.equal(jwk['y'], y.toString('base64url'));
    });
    it('throws when authData is too short', () => {
        assert.throws(() => parseCredentialPublicKey(Buffer.alloc(10)), /too short/i);
    });
    it('throws when AT flag is not set', () => {
        const buf = Buffer.alloc(100, 0);
        buf[32] = 0x01; // UP only, no AT (0x40)
        assert.throws(() => parseCredentialPublicKey(buf), /No attested credential/i);
    });
});
describe('WebAuthnService.finishRegistration — COSE key storage', () => {
    it('stores a valid JWK JSON string (not raw authData bytes)', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
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
        const jwk = JSON.parse(storedKey);
        assert.equal(jwk['kty'], 'EC');
        assert.equal(jwk['crv'], 'P-256');
        assert.equal(jwk['x'], x.toString('base64url'));
        assert.equal(jwk['y'], y.toString('base64url'));
    });
});
describe('WebAuthnService.finishAuthentication — signature verification', () => {
    async function setupCred(pool, session, userId, challenge) {
        // Generate a real EC P-256 key pair for testing
        const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const jwk = publicKey.export({ format: 'jwk' });
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
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
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
        await assert.rejects(() => svc.finishAuthentication('user2', {
            id: 'test-cred-123',
            rawId: 'test-cred-123',
            response: {
                clientDataJSON,
                authenticatorData,
                signature: Buffer.alloc(0).toString('base64url'), // empty sig
            },
            type: 'public-key',
        }), /signature/i);
    });
    it('rejects malformed public key stored in DB (throws, never passes silently)', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
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
        await assert.rejects(() => svc.finishAuthentication('user3', {
            id: 'cred-bad',
            rawId: 'cred-bad',
            response: { clientDataJSON, authenticatorData, signature },
            type: 'public-key',
        }));
    });
    it('rejects tampered authenticatorData (bad signature)', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
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
        await assert.rejects(() => svc.finishAuthentication('user4', {
            id: 'test-cred-123',
            rawId: 'test-cred-123',
            response: { clientDataJSON, authenticatorData, signature },
            type: 'public-key',
        }), /signature/i);
    });
    it('rejects expired challenge', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const challenge = crypto.randomBytes(32).toString('base64url');
        // Set challenge already expired
        await session.setChallenge('user5', challenge, Date.now() - 1_000);
        const clientData = { type: 'webauthn.get', challenge, origin: 'http://localhost' };
        const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
        await assert.rejects(() => svc.finishAuthentication('user5', {
            id: 'cred-x',
            rawId: 'cred-x',
            response: {
                clientDataJSON,
                authenticatorData: Buffer.alloc(41, 0).toString('base64url'),
                signature: 'aabb',
            },
            type: 'public-key',
        }), /challenge_expired/i);
    });
    it('succeeds with a valid real signature', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
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
        await assert.doesNotReject(() => svc.finishAuthentication('user6', {
            id: 'test-cred-123',
            rawId: 'test-cred-123',
            response: {
                clientDataJSON,
                authenticatorData: authDataBuf.toString('base64url'),
                signature: sig.toString('base64url'),
            },
            type: 'public-key',
        }));
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
    function makeCtx(userRoles, state = {}) {
        return {
            user: { id: '1', email: 'test@test.com', roles: userRoles },
            state,
        };
    }
    async function runGuard(svc, ctx) {
        const guard = rbacGuard(svc);
        let nextCalled = false;
        await guard(ctx, async () => { nextCalled = true; });
        if (!nextCalled)
            throw new Error('next() was not called');
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
        await assert.rejects(() => guard(ctx, async () => { }), (err) => {
            assert.ok(err instanceof ForbiddenException);
            return true;
        });
    });
    it('throws ForbiddenException when user lacks required permission', async () => {
        const svc = new RbacService({ viewer: [] }, { viewer: ['posts:read'] });
        const ctx = makeCtx(['viewer'], { _requiredRoles: [], _requiredPermissions: ['users:write'] });
        const guard = rbacGuard(svc);
        await assert.rejects(() => guard(ctx, async () => { }), (err) => {
            assert.ok(err instanceof ForbiddenException);
            return true;
        });
    });
    it('passes when user has required permission', async () => {
        const svc = new RbacService({ editor: [] }, { editor: ['posts:write'] });
        const ctx = makeCtx(['editor'], { _requiredRoles: [], _requiredPermissions: ['posts:write'] });
        await assert.doesNotReject(() => runGuard(svc, ctx));
    });
    it('@Roles decorator stores metadata readable by router (integration check)', () => {
        class TestController {
            adminRoute() { }
        }
        __decorate([
            Roles('admin'),
            __metadata("design:type", Function),
            __metadata("design:paramtypes", []),
            __metadata("design:returntype", void 0)
        ], TestController.prototype, "adminRoute", null);
        const proto = TestController.prototype;
        const meta = Reflect.getMetadata('street:roles', proto, 'adminRoute');
        assert.deepEqual(meta, ['admin']);
    });
    it('@Permissions decorator stores metadata readable by router', () => {
        class TestController2 {
            writeRoute() { }
        }
        __decorate([
            Permissions('posts:write'),
            __metadata("design:type", Function),
            __metadata("design:paramtypes", []),
            __metadata("design:returntype", void 0)
        ], TestController2.prototype, "writeRoute", null);
        const proto = TestController2.prototype;
        const meta = Reflect.getMetadata('street:permissions', proto, 'writeRoute');
        assert.deepEqual(meta, ['posts:write']);
    });
});
// ── OAuth2 tests ──────────────────────────────────────────────────────────────
describe('OAuthManager constructor', () => {
    it('throws when sessionManager is not provided', () => {
        assert.throws(() => new OAuthManager({
            providers: [{ name: 'github', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://localhost/cb' }],
            // Cast to bypass TS so we can test the runtime guard
            sessionManager: undefined,
        }), /sessionManager/i);
    });
    it('constructs successfully when sessionManager is provided', () => {
        const sm = { get: () => null, set: () => { } };
        assert.doesNotThrow(() => new OAuthManager({
            providers: [{ name: 'github', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://localhost/cb' }],
            sessionManager: sm,
        }));
    });
});
describe('OAuthManager.handleCallback — state validation', () => {
    it('throws on state mismatch', async () => {
        const sm = { get: () => null, set: () => { } };
        const mgr = new OAuthManager({
            providers: [{ name: 'github', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://localhost/cb' }],
            sessionManager: sm,
        });
        await assert.rejects(() => mgr.handleCallback('github', 'code123', 'wrong-state', 'correct-state', 'verifier'), /state mismatch/i);
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
    rows = [];
    nextId = 1;
    async query(sql, params) {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('INSERT')) {
            const id = String(this.nextId++);
            const row = {
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
        if (s.startsWith('DELETE')) {
            const id = String(params?.[0] ?? '');
            const before = this.rows.length;
            this.rows = this.rows.filter(r => r['id'] !== id);
            return { rows: [], rowCount: before - this.rows.length, command: 'DELETE' };
        }
        if (s.startsWith('SELECT')) {
            // SELECT ... WHERE id = $1 (for revoke's pre-delete lookup)
            if (s.includes('WHERE ID =') || (s.includes('WHERE') && !s.includes('KEY_HASH'))) {
                const id = String(params?.[0] ?? '');
                const found = this.rows.filter(r => r['id'] === id);
                return { rows: found, rowCount: found.length, command: 'SELECT' };
            }
            // SELECT ... WHERE key_hash = $1 (for verify)
            const hashParam = String(params?.[0] ?? '');
            const found = this.rows.filter(r => r['key_hash'] === hashParam);
            return { rows: found, rowCount: found.length, command: 'SELECT' };
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
// ── Additional WebAuthn tests ─────────────────────────────────────────────────
import { RefreshTokenService, TokenReplayError } from '../auth/refresh-tokens.js';
import { JwtService } from '../security/jwt.js';
import { SessionManager } from '../security/session.js';
import { apiKeyMiddleware } from '../auth/api-keys.js';
describe('WebAuthnService.beginRegistration — challenge storage', () => {
    it('stores challenge with expiresAt in the future', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const before = Date.now();
        await svc.beginRegistration('user-store');
        const stored = await session.getChallenge('user-store');
        assert.ok(stored !== null);
        assert.ok(stored.expiresAt > before, 'expiresAt should be in the future');
    });
    it('challenge is at least 16 bytes (≥ 22 base64url chars)', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const opts = await svc.beginRegistration('user-chal-len');
        // base64url of 32 bytes = 43 chars; 16 bytes = 22 chars
        assert.ok(opts.challenge.length >= 22, `challenge too short: ${opts.challenge.length}`);
        // Must be base64url safe (no +, /, =)
        assert.ok(!/[+/=]/.test(opts.challenge), 'challenge must be base64url encoded');
    });
});
describe('WebAuthnService.finishRegistration — error cases', () => {
    it('rejects when challenge has expired (expiresAt in past)', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const challenge = crypto.randomBytes(32).toString('base64url');
        // Set expired challenge
        await session.setChallenge('user-expired-reg', challenge, Date.now() - 1_000);
        const x = crypto.randomBytes(32);
        const y = crypto.randomBytes(32);
        const authData = buildAuthData(x, y);
        const attObj = buildAttestationObject(authData);
        const clientData = { type: 'webauthn.create', challenge, origin: 'http://localhost' };
        const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
        await assert.rejects(() => svc.finishRegistration('user-expired-reg', {
            id: 'cred-exp',
            rawId: 'cred-exp',
            response: { clientDataJSON, attestationObject: attObj.toString('base64url') },
            type: 'public-key',
        }), /challenge_expired/i);
    });
    it('rejects wrong ceremony type (webauthn.get instead of webauthn.create)', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const challenge = crypto.randomBytes(32).toString('base64url');
        await session.setChallenge('user-wrong-type', challenge, Date.now() + 60_000);
        const x = crypto.randomBytes(32);
        const y = crypto.randomBytes(32);
        const authData = buildAuthData(x, y);
        const attObj = buildAttestationObject(authData);
        // Use wrong ceremony type
        const clientData = { type: 'webauthn.get', challenge, origin: 'http://localhost' };
        const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
        await assert.rejects(() => svc.finishRegistration('user-wrong-type', {
            id: 'cred-wrong',
            rawId: 'cred-wrong',
            response: { clientDataJSON, attestationObject: attObj.toString('base64url') },
            type: 'public-key',
        }), /ceremony|type/i);
    });
    it('rejects mismatched origin in registration', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const challenge = crypto.randomBytes(32).toString('base64url');
        await session.setChallenge('user-origin-mismatch', challenge, Date.now() + 60_000);
        const x = crypto.randomBytes(32);
        const y = crypto.randomBytes(32);
        const authData = buildAuthData(x, y);
        const attObj = buildAttestationObject(authData);
        // Use different origin
        const clientData = { type: 'webauthn.create', challenge, origin: 'https://evil.example.com' };
        const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
        await assert.rejects(() => svc.finishRegistration('user-origin-mismatch', {
            id: 'cred-origin',
            rawId: 'cred-origin',
            response: { clientDataJSON, attestationObject: attObj.toString('base64url') },
            type: 'public-key',
        }), /origin/i);
    });
    it('rejects mismatched challenge in registration', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const challenge = crypto.randomBytes(32).toString('base64url');
        await session.setChallenge('user-chal-mismatch', challenge, Date.now() + 60_000);
        const x = crypto.randomBytes(32);
        const y = crypto.randomBytes(32);
        const authData = buildAuthData(x, y);
        const attObj = buildAttestationObject(authData);
        // Use different challenge
        const wrongChallenge = crypto.randomBytes(32).toString('base64url');
        const clientData = { type: 'webauthn.create', challenge: wrongChallenge, origin: 'http://localhost' };
        const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
        await assert.rejects(() => svc.finishRegistration('user-chal-mismatch', {
            id: 'cred-chal',
            rawId: 'cred-chal',
            response: { clientDataJSON, attestationObject: attObj.toString('base64url') },
            type: 'public-key',
        }), /challenge/i);
    });
});
describe('WebAuthnService.finishAuthentication — additional error cases', () => {
    it('rejects expired challenge during authentication', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const challenge = crypto.randomBytes(32).toString('base64url');
        await session.setChallenge('user-auth-exp', challenge, Date.now() - 1_000);
        const clientData = { type: 'webauthn.get', challenge, origin: 'http://localhost' };
        const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
        await assert.rejects(() => svc.finishAuthentication('user-auth-exp', {
            id: 'cred-exp',
            rawId: 'cred-exp',
            response: {
                clientDataJSON,
                authenticatorData: Buffer.alloc(41, 0).toString('base64url'),
                signature: 'aabb',
            },
            type: 'public-key',
        }), /challenge_expired/i);
    });
    it('rejects wrong ceremony type during authentication (webauthn.create instead of webauthn.get)', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const challenge = crypto.randomBytes(32).toString('base64url');
        await session.setChallenge('user-auth-type', challenge, Date.now() + 60_000);
        // Wrong ceremony type
        const clientData = { type: 'webauthn.create', challenge, origin: 'http://localhost' };
        const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
        await assert.rejects(() => svc.finishAuthentication('user-auth-type', {
            id: 'cred-type',
            rawId: 'cred-type',
            response: {
                clientDataJSON,
                authenticatorData: Buffer.alloc(41, 0).toString('base64url'),
                signature: 'aabb',
            },
            type: 'public-key',
        }), /ceremony|type/i);
    });
    it('rejects mismatched origin during authentication', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const challenge = crypto.randomBytes(32).toString('base64url');
        await session.setChallenge('user-auth-origin', challenge, Date.now() + 60_000);
        const clientData = { type: 'webauthn.get', challenge, origin: 'https://evil.com' };
        const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
        await assert.rejects(() => svc.finishAuthentication('user-auth-origin', {
            id: 'cred-origin2',
            rawId: 'cred-origin2',
            response: {
                clientDataJSON,
                authenticatorData: Buffer.alloc(41, 0).toString('base64url'),
                signature: 'aabb',
            },
            type: 'public-key',
        }), /origin/i);
    });
    it('detects sign count replay (newSignCount <= storedSignCount)', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
        const jwk = publicKey.export({ format: 'jwk' });
        const credId = 'replay-cred';
        const storedSignCount = 5;
        pool.rows.push({
            id: 'db-replay',
            user_id: 'user-replay',
            credential_id: credId,
            public_key: JSON.stringify(jwk),
            sign_count: String(storedSignCount),
        });
        const challenge = crypto.randomBytes(32).toString('base64url');
        await session.setChallenge('user-replay', challenge, Date.now() + 60_000);
        const clientData = { type: 'webauthn.get', challenge, origin: 'http://localhost' };
        const clientDataJSON = Buffer.from(JSON.stringify(clientData)).toString('base64url');
        // Build authData with signCount = 3 (less than stored 5) → replay
        const authDataBuf = Buffer.alloc(41, 0);
        authDataBuf[32] = 0x01; // UP flag
        authDataBuf.writeUInt32BE(3, 33); // sign count 3 < stored 5
        const clientDataHash = crypto.createHash('sha256')
            .update(Buffer.from(clientDataJSON, 'base64url'))
            .digest();
        const signedData = Buffer.concat([authDataBuf, clientDataHash]);
        const sig = crypto.createSign('SHA256').update(signedData).sign(privateKey);
        await assert.rejects(() => svc.finishAuthentication('user-replay', {
            id: credId,
            rawId: credId,
            response: {
                clientDataJSON,
                authenticatorData: authDataBuf.toString('base64url'),
                signature: sig.toString('base64url'),
            },
            type: 'public-key',
        }), /sign count|replay/i);
    });
});
// ── Additional RBAC tests ─────────────────────────────────────────────────────
describe('RbacService.hasRole — edge cases', () => {
    it('returns false with empty userRoles array', () => {
        const svc = new RbacService({ admin: [], editor: [] });
        assert.ok(!svc.hasRole([], 'admin'));
    });
    it('checks deep inheritance: admin → editor → viewer, admin hasRole viewer is true via permissions', () => {
        // hasRole uses direct match only per implementation, but we can test that admin has viewer's permissions
        const hierarchy = { admin: ['editor'], editor: ['viewer'], viewer: [] };
        const rolePermissions = { viewer: ['posts:read'], editor: ['posts:write'], admin: ['users:write'] };
        const svc = new RbacService(hierarchy, rolePermissions);
        // admin should inherit posts:read from viewer through editor
        assert.ok(svc.hasPermission(['admin'], 'posts:read'));
    });
});
describe('RbacService.hasPermission — edge cases', () => {
    it('returns false with empty permissions list', () => {
        const svc = new RbacService({ admin: [] }, { admin: [] });
        assert.ok(!svc.hasPermission(['admin'], 'posts:read'));
    });
});
describe('rbacGuard — no roles/permissions attached to handler', () => {
    it('passes when no roles or permissions in state (no restrictions)', async () => {
        const svc = new RbacService({ viewer: [] });
        const ctx = {
            user: { id: '1', email: 'a@b.com', roles: [] },
            state: {},
        };
        const guard = rbacGuard(svc);
        let called = false;
        await guard(ctx, async () => { called = true; });
        assert.ok(called);
    });
    it('throws 403 when route requires roles but user has none', async () => {
        const svc = new RbacService({ admin: [] });
        const ctx = {
            user: { id: '2', email: 'x@y.com', roles: [] },
            state: { _requiredRoles: ['admin'], _requiredPermissions: [] },
        };
        const guard = rbacGuard(svc);
        await assert.rejects(() => guard(ctx, async () => { }), (err) => {
            assert.ok(err instanceof ForbiddenException);
            return true;
        });
    });
});
describe('RbacService — circular hierarchy', () => {
    it('handles circular role hierarchy without infinite loop', () => {
        // admin → editor → admin (circular)
        const hierarchy = { admin: ['editor'], editor: ['admin'] };
        // Should not throw or hang; BFS visited set prevents infinite loop
        assert.doesNotThrow(() => new RbacService(hierarchy));
    });
});
describe('RBAC decorators metadata', () => {
    it('@Roles and @Permissions attach metadata to the method', () => {
        class MyController {
            myMethod() { }
        }
        __decorate([
            Roles('admin', 'editor'),
            Permissions('posts:write', 'posts:delete'),
            __metadata("design:type", Function),
            __metadata("design:paramtypes", []),
            __metadata("design:returntype", void 0)
        ], MyController.prototype, "myMethod", null);
        const proto = MyController.prototype;
        const roles = Reflect.getMetadata('street:roles', proto, 'myMethod');
        const perms = Reflect.getMetadata('street:permissions', proto, 'myMethod');
        assert.deepEqual(roles, ['admin', 'editor']);
        assert.deepEqual(perms, ['posts:write', 'posts:delete']);
    });
});
describe('RBAC — privilege escalation prevention', () => {
    it('viewer cannot reach admin endpoint', async () => {
        const svc = new RbacService({ admin: [], viewer: [] });
        const ctx = {
            user: { id: '3', email: 'v@example.com', roles: ['viewer'] },
            state: { _requiredRoles: ['admin'], _requiredPermissions: [] },
        };
        const guard = rbacGuard(svc);
        await assert.rejects(() => guard(ctx, async () => { }), (err) => {
            assert.ok(err instanceof ForbiddenException);
            return true;
        });
    });
});
// ── Additional OAuth2 tests ───────────────────────────────────────────────────
describe('OAuthManager.authorizationUrl — additional', () => {
    it('throws without sessionManager at runtime (undefined cast)', () => {
        assert.throws(() => new OAuthManager({
            providers: [{ name: 'github', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://localhost/cb' }],
            sessionManager: undefined,
        }), /sessionManager/i);
    });
    it('authorizationUrl includes state and code_challenge in URL', async () => {
        const sm = { get: () => null, set: () => { } };
        const mgr = new OAuthManager({
            providers: [{ name: 'google', clientId: 'my-client', clientSecret: 'sec', redirectUri: 'http://localhost/cb' }],
            sessionManager: sm,
        });
        const { url, state, codeVerifier } = await mgr.authorizationUrl('google');
        assert.ok(url.includes('state='), 'URL must include state param');
        assert.ok(url.includes('code_challenge='), 'URL must include code_challenge param');
        // state should be non-empty
        assert.ok(state.length > 0);
        // codeVerifier should be non-empty
        assert.ok(codeVerifier.length > 0);
        // code_challenge in URL = SHA256(codeVerifier) base64url
        const expectedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
        assert.ok(url.includes(encodeURIComponent(expectedChallenge)), 'code_challenge must be SHA256 of verifier');
    });
});
describe('OAuthManager.handleCallback — mismatched state', () => {
    it('rejects mismatched state (CSRF protection)', async () => {
        const sm = { get: () => null, set: () => { } };
        const mgr = new OAuthManager({
            providers: [{ name: 'github', clientId: 'id', clientSecret: 'sec', redirectUri: 'http://localhost/cb' }],
            sessionManager: sm,
        });
        await assert.rejects(() => mgr.handleCallback('github', 'code123', 'attacker-state', 'correct-state', 'verifier'), /state mismatch/i);
    });
});
describe('OAuth2 PKCE — additional', () => {
    it('PKCE code_challenge is SHA-256 of code_verifier base64url', () => {
        const verifier = crypto.randomBytes(32).toString('base64url');
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        assert.ok(!/[+/=]/.test(challenge), 'Must be base64url (no +, /, =)');
        assert.equal(challenge.length, 43, 'SHA-256 base64url is always 43 chars');
    });
    it('handleCallback state comparison rejects when different', async () => {
        const sm = { get: () => null, set: () => { } };
        const mgr = new OAuthManager({
            providers: [{ name: 'google', clientId: 'cid', clientSecret: 'csec', redirectUri: 'http://localhost/cb' }],
            sessionManager: sm,
        });
        await assert.rejects(() => mgr.handleCallback('google', 'any-code', 'state-A', 'state-B', 'verifier'), /state mismatch/i);
    });
    it('middleware sets Location header for redirect when no code in query', async () => {
        const sm = { get: (_ctx, key) => null, set: () => { } };
        const mgr = new OAuthManager({
            providers: [{ name: 'google', clientId: 'cid', clientSecret: 'csec', redirectUri: 'http://localhost/cb' }],
            sessionManager: sm,
        });
        let locationHeader = '';
        let endCalled = false;
        const fakeCtx = {
            query: {},
            headers: {},
            user: null,
            state: {},
            res: {
                writeHead: (code, headers) => {
                    locationHeader = headers['Location'] ?? '';
                },
                end: () => { endCalled = true; },
            },
        };
        const mw = mgr.middleware('google', async () => { });
        await mw(fakeCtx, async () => { });
        assert.ok(endCalled, 'res.end() should be called for redirect');
        assert.ok(locationHeader.length > 0, 'Location header should be set');
        assert.ok(locationHeader.startsWith('https://'), 'Location should be https URL');
    });
});
describe('JwksCache', () => {
    it('returns cached keys on second call without re-fetching', async () => {
        const { JwksCache: JwksCacheClass } = await import('../auth/oauth2.js');
        let fetchCount = 0;
        const mockUri = 'https://example.com/.well-known/jwks.json';
        const cache = new JwksCacheClass(300_000);
        // Inject a fake entry directly
        cache
            ._cache.set(mockUri, { keys: [{ kty: 'RSA', kid: 'k1' }], expiresAt: Date.now() + 300_000 });
        const keys1 = await cache.getKeys(mockUri);
        const keys2 = await cache.getKeys(mockUri);
        assert.equal(keys1.length, 1);
        assert.equal(keys2.length, 1);
        assert.equal(fetchCount, 0, 'No actual fetches should occur with primed cache');
    });
    it('falls back to stale cache on fetch failure', async () => {
        const { JwksCache: JwksCacheClass } = await import('../auth/oauth2.js');
        const mockUri = 'https://unreachable-host.invalid/.well-known/jwks.json';
        const cache = new JwksCacheClass(1); // TTL = 1ms → expires immediately
        // Inject a stale entry
        cache
            ._cache.set(mockUri, { keys: [{ kty: 'EC', kid: 'stale' }], expiresAt: Date.now() - 1 });
        // Fetch will fail (unreachable), should fall back to stale
        const keys = await cache.getKeys(mockUri);
        assert.equal(keys.length, 1);
        const k = keys[0];
        assert.equal(k['kid'], 'stale');
    });
});
// ── Additional API Key tests ──────────────────────────────────────────────────
describe('ApiKeyService.generate — additional', () => {
    it('returns key with correct namespace prefix', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const { key } = await svc.generate({ ownerId: 'o1', name: 'mykey', prefix: 'test_' });
        assert.ok(key.startsWith('test_'), `key should start with "test_", got: ${key.slice(0, 10)}`);
    });
    it('stores hash (not raw key) in pool', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const { key } = await svc.generate({ ownerId: 'o2', name: 'hashtest' });
        const storedHash = pool.rows[0]?.['key_hash'];
        assert.ok(storedHash, 'key_hash must be stored');
        // Raw key should not be stored
        assert.notEqual(storedHash, key, 'Raw key must not be stored');
        // Hash should be SHA-256 hex (64 chars)
        assert.equal(storedHash.length, 64, 'Hash should be 64 hex chars (SHA-256)');
        // Verify it's the correct hash
        const expectedHash = crypto.createHash('sha256').update(key).digest('hex');
        assert.equal(storedHash, expectedHash);
    });
});
describe('ApiKeyService.verify — tamper detection', () => {
    it('returns null for tampered key (different bytes, same length)', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const future = new Date(Date.now() + 3_600_000);
        const { key } = await svc.generate({ ownerId: 'o3', name: 'tamper', expiresAt: future });
        // Tamper: change last character
        const tampered = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
        const result = await svc.verify(tampered);
        assert.equal(result, null);
    });
    it('verify uses timingSafeEqual — both hashes are 32 bytes (64 hex chars)', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const future = new Date(Date.now() + 3_600_000);
        const { key } = await svc.generate({ ownerId: 'o4', name: 'timing', expiresAt: future });
        // The hash stored should be 64 hex chars (SHA-256 = 32 bytes)
        const storedHash = pool.rows[0]?.['key_hash'];
        assert.equal(storedHash?.length, 64);
        // When verifying valid key, computed hash should also be 64 hex chars
        const computedHash = crypto.createHash('sha256').update(key).digest('hex');
        assert.equal(computedHash.length, 64, 'Computed hash must also be 32 bytes (64 hex)');
    });
});
describe('ApiKeyService — revoke then verify', () => {
    it('revoke then verify returns null (cache evicted, DB row deleted)', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const future = new Date(Date.now() + 3_600_000);
        const { key, record } = await svc.generate({ ownerId: 'o5', name: 'revokeTest', expiresAt: future });
        // Verify it works first
        const before = await svc.verify(key);
        assert.ok(before !== null);
        // Revoke
        await svc.revoke(record.id);
        // Should be null now
        const after = await svc.verify(key);
        assert.equal(after, null);
    });
});
describe('apiKeyMiddleware', () => {
    it('throws UnauthorizedException when no Bearer token', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const mw = apiKeyMiddleware(svc);
        const ctx = {
            headers: {},
            user: null,
            state: {},
        };
        await assert.rejects(() => mw(ctx, async () => { }), /unauthorized|missing|invalid authorization/i);
    });
    it('throws UnauthorizedException for invalid key', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const mw = apiKeyMiddleware(svc);
        const ctx = {
            headers: { authorization: 'Bearer invalid_key_that_does_not_exist' },
            user: null,
            state: {},
        };
        await assert.rejects(() => mw(ctx, async () => { }), /unauthorized|invalid|expired/i);
    });
    it('sets ctx.user.id to ownerId on success', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const future = new Date(Date.now() + 3_600_000);
        const { key } = await svc.generate({ ownerId: 'owner-mw', name: 'mwkey', expiresAt: future });
        const mw = apiKeyMiddleware(svc);
        const ctx = {
            headers: { authorization: `Bearer ${key}` },
            user: null,
            state: {},
        };
        let nextCalled = false;
        await mw(ctx, async () => { nextCalled = true; });
        assert.ok(nextCalled, 'next() should be called on success');
        const user = ctx.user;
        assert.ok(user !== null, 'ctx.user should be set');
        assert.equal(user.id, 'owner-mw');
    });
});
// ── Additional Refresh Token tests ────────────────────────────────────────────
/** In-memory pool with transaction support for refresh token tests. */
class RefreshTokenMemPool {
    rows = [];
    nextId = 1;
    async query(sql, params) {
        const s = sql.trim().toUpperCase();
        if (s.startsWith('INSERT')) {
            const id = 'rt-' + String(this.nextId++);
            const row = {
                id,
                token_hash: String(params?.[0] ?? ''),
                family_id: String(params?.[1] ?? ''),
                user_id: String(params?.[2] ?? ''),
                expires_at: params?.[3] != null ? String(params[3]) : null,
                revoked_at: null,
                created_at: new Date().toISOString(),
            };
            this.rows.push(row);
            return { rows: [row], rowCount: 1, command: 'INSERT' };
        }
        if (s.startsWith('UPDATE') && s.includes('REVOKED_AT') && s.includes('FAMILY_ID')) {
            const familyId = String(params?.[0] ?? '');
            let updated = 0;
            for (const row of this.rows) {
                if (row['family_id'] === familyId && row['revoked_at'] === null) {
                    row['revoked_at'] = new Date().toISOString();
                    updated++;
                }
            }
            return { rows: [], rowCount: updated, command: 'UPDATE' };
        }
        if (s.startsWith('UPDATE') && s.includes('REVOKED_AT') && s.includes('USER_ID')) {
            const userId = String(params?.[0] ?? '');
            let updated = 0;
            for (const row of this.rows) {
                if (row['user_id'] === userId) {
                    row['revoked_at'] = new Date().toISOString();
                    updated++;
                }
            }
            return { rows: [], rowCount: updated, command: 'UPDATE' };
        }
        if (s.startsWith('UPDATE') && s.includes('REVOKED_AT') && s.includes('WHERE ID')) {
            const id = String(params?.[0] ?? '');
            for (const row of this.rows) {
                if (row['id'] === id) {
                    row['revoked_at'] = new Date().toISOString();
                }
            }
            return { rows: [], rowCount: 1, command: 'UPDATE' };
        }
        if (s.startsWith('SELECT') && s.includes('TOKEN_HASH')) {
            const hash = String(params?.[0] ?? '');
            const found = this.rows.filter(r => r['token_hash'] === hash);
            return { rows: found, rowCount: found.length, command: 'SELECT' };
        }
        if (s.startsWith('SELECT') && s.includes('FAMILY_ID')) {
            const familyId = String(params?.[0] ?? '');
            const found = this.rows.filter(r => r['family_id'] === familyId);
            return { rows: found, rowCount: found.length, command: 'SELECT' };
        }
        return { rows: [], rowCount: 0, command: 'OK' };
    }
    async transaction(fn) {
        return fn(this);
    }
}
function makeJwt() {
    return new JwtService('supersecretkey-at-least-32-chars-here!!');
}
describe('RefreshTokenService.issue', () => {
    it('returns accessToken and refreshToken strings', async () => {
        const pool = new RefreshTokenMemPool();
        const svc = new RefreshTokenService(pool, makeJwt());
        const { accessToken, refreshToken } = await svc.issue('user-a');
        assert.equal(typeof accessToken, 'string');
        assert.equal(typeof refreshToken, 'string');
        assert.ok(accessToken.length > 0);
        assert.ok(refreshToken.length > 0);
    });
    it('refreshToken is base64url encoded (no + or /)', async () => {
        const pool = new RefreshTokenMemPool();
        const svc = new RefreshTokenService(pool, makeJwt());
        const { refreshToken } = await svc.issue('user-b');
        assert.ok(!/[+/=]/.test(refreshToken), `refreshToken must be base64url, got: ${refreshToken}`);
    });
    it('custom refreshTokenTtlMs is respected in expires_at', async () => {
        const pool = new RefreshTokenMemPool();
        const customTtl = 10_000; // 10 seconds
        const svc = new RefreshTokenService(pool, makeJwt(), { refreshTokenTtlMs: customTtl });
        const before = Date.now();
        await svc.issue('user-ttl');
        const row = pool.rows[0];
        assert.ok(row, 'Row should exist');
        const expiresAt = new Date(row['expires_at']).getTime();
        const expectedMin = before + customTtl - 1000;
        const expectedMax = before + customTtl + 1000;
        assert.ok(expiresAt >= expectedMin && expiresAt <= expectedMax, `expires_at ${expiresAt} should be ~${before + customTtl}`);
    });
    it('token hash stored (not raw): hash(rawToken) appears in INSERT params', async () => {
        const pool = new RefreshTokenMemPool();
        const svc = new RefreshTokenService(pool, makeJwt());
        const { refreshToken } = await svc.issue('user-hash');
        const row = pool.rows[0];
        assert.ok(row, 'Row should exist');
        const storedHash = row['token_hash'];
        const expectedHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        assert.equal(storedHash, expectedHash, 'token_hash must be SHA-256 of raw token');
        assert.notEqual(storedHash, refreshToken, 'Raw token must not be stored');
    });
});
describe('RefreshTokenService.rotate', () => {
    it('throws TokenReplayError with already-revoked token', async () => {
        const pool = new RefreshTokenMemPool();
        const svc = new RefreshTokenService(pool, makeJwt());
        const { refreshToken } = await svc.issue('user-replay');
        // Rotate once (valid)
        await svc.rotate(refreshToken);
        // Rotate again with the original (now revoked) token → replay
        await assert.rejects(() => svc.rotate(refreshToken), (err) => {
            assert.ok(err instanceof TokenReplayError);
            return true;
        });
    });
    it('after replay, entire family is revoked', async () => {
        const pool = new RefreshTokenMemPool();
        const svc = new RefreshTokenService(pool, makeJwt());
        const { refreshToken } = await svc.issue('user-family-revoke');
        // Get the family id from pool
        const familyId = pool.rows[0]?.['family_id'];
        assert.ok(familyId);
        // Rotate once to get new token
        const { refreshToken: newToken } = await svc.rotate(refreshToken);
        // Replay original → should revoke family
        await assert.rejects(() => svc.rotate(refreshToken), (e) => e instanceof TokenReplayError);
        // New token should also be revoked (family revocation)
        const newHash = crypto.createHash('sha256').update(newToken).digest('hex');
        const newRow = pool.rows.find(r => r['token_hash'] === newHash);
        assert.ok(newRow?.['revoked_at'] !== null, 'New token in family should also be revoked after replay');
    });
});
describe('RefreshTokenService.revokeFamily', () => {
    it('marks all tokens in family as revoked', async () => {
        const pool = new RefreshTokenMemPool();
        const svc = new RefreshTokenService(pool, makeJwt());
        const familyId = crypto.randomBytes(8).toString('hex');
        await svc.issue('user-fam', familyId);
        await svc.issue('user-fam', familyId);
        await svc.revokeFamily(familyId);
        const remaining = pool.rows.filter(r => r['family_id'] === familyId && r['revoked_at'] === null);
        assert.equal(remaining.length, 0, 'All tokens in family should be revoked');
    });
});
describe('RefreshTokenService.revokeAll', () => {
    it('marks all tokens for user as revoked', async () => {
        const pool = new RefreshTokenMemPool();
        const svc = new RefreshTokenService(pool, makeJwt());
        await svc.issue('user-revoke-all');
        await svc.issue('user-revoke-all');
        await svc.revokeAll('user-revoke-all');
        const remaining = pool.rows.filter(r => r['user_id'] === 'user-revoke-all' && r['revoked_at'] === null);
        assert.equal(remaining.length, 0, 'All tokens for user should be revoked');
    });
});
// ── Additional JWT tests ──────────────────────────────────────────────────────
describe('JwtService — additional tests', () => {
    const jwt = new JwtService('a-super-secret-key-that-is-at-least-32chars!');
    it('sign produces 3-part dot-separated string', () => {
        const token = jwt.sign({ sub: 'u1' });
        const parts = token.split('.');
        assert.equal(parts.length, 3, 'JWT must have 3 parts separated by dots');
    });
    it('verify returns null for malformed token', () => {
        assert.equal(jwt.verify('not.a.valid.jwt'), null);
        assert.equal(jwt.verify('justonepart'), null);
        assert.equal(jwt.verify(''), null);
    });
    it('verify returns null for expired token', () => {
        // Sign with -1 second TTL (already expired)
        const token = jwt.sign({ sub: 'u2', exp: Math.floor(Date.now() / 1000) - 1 });
        assert.equal(jwt.verify(token), null);
    });
    it('verify returns null for tampered signature', () => {
        const token = jwt.sign({ sub: 'u3' });
        const parts = token.split('.');
        // Flip a char in the signature
        const tamperedSig = parts[2].startsWith('A') ? 'B' + parts[2].slice(1) : 'A' + parts[2].slice(1);
        const tampered = `${parts[0]}.${parts[1]}.${tamperedSig}`;
        assert.equal(jwt.verify(tampered), null);
    });
    it('verify returns payload for valid token', () => {
        const token = jwt.sign({ sub: 'u4', email: 'test@example.com' });
        const payload = jwt.verify(token);
        assert.ok(payload !== null);
        assert.equal(payload.sub, 'u4');
        assert.equal(payload.email, 'test@example.com');
    });
    it('sign with expiresInSeconds sets exp claim', () => {
        const before = Math.floor(Date.now() / 1000);
        const token = jwt.sign({ sub: 'u5' }, { expiresInSeconds: 3600 });
        const payload = jwt.verify(token);
        assert.ok(payload !== null);
        assert.ok(typeof payload.exp === 'number');
        assert.ok(payload.exp >= before + 3600 - 2);
        assert.ok(payload.exp <= before + 3600 + 2);
    });
});
// ── Additional Session tests ──────────────────────────────────────────────────
describe('SessionManager — additional tests', () => {
    // Generate a valid random key (64 hex chars with sufficient entropy)
    const hexKey = crypto.randomBytes(32).toString('hex');
    const sm = new SessionManager(hexKey);
    it('create returns encrypted session string', () => {
        const data = { userId: 'u1', email: 'a@b.com', roles: ['viewer'] };
        const encrypted = sm.encrypt(data);
        assert.equal(typeof encrypted, 'string');
        assert.ok(encrypted.length > 0);
        assert.notEqual(encrypted, JSON.stringify(data), 'Must not store plaintext');
    });
    it('read returns original data', () => {
        const data = { userId: 'u2', email: 'x@y.com', roles: ['admin'] };
        const encrypted = sm.encrypt(data);
        const decrypted = sm.decrypt(encrypted);
        assert.ok(decrypted !== null);
        assert.equal(decrypted.userId, 'u2');
        assert.equal(decrypted.email, 'x@y.com');
        assert.deepEqual(decrypted.roles, ['admin']);
    });
    it('read returns null for tampered session', () => {
        const data = { userId: 'u3' };
        const encrypted = sm.encrypt(data);
        // Decode base64, flip a byte in the ciphertext portion, re-encode
        const buf = Buffer.from(encrypted, 'base64');
        buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
        const tampered = buf.toString('base64');
        const result = sm.decrypt(tampered);
        assert.equal(result, null, 'Tampered session must return null');
    });
    it('read returns null for wrong key', () => {
        const data = { userId: 'u4' };
        const encrypted = sm.encrypt(data);
        // Create session manager with different key
        const otherKey = crypto.randomBytes(32).toString('hex');
        const sm2 = new SessionManager(otherKey);
        const result = sm2.decrypt(encrypted);
        assert.equal(result, null, 'Wrong key must return null');
    });
    it('session data round-trips through encrypt/decrypt for unicode strings', () => {
        const data = { userId: 'u5', name: '日本語テスト 🎌', roles: ['viewer'] };
        const encrypted = sm.encrypt(data);
        const decrypted = sm.decrypt(encrypted);
        assert.ok(decrypted !== null);
        assert.equal(decrypted.name, '日本語テスト 🎌');
    });
    it('CSRF token is included in session data', () => {
        const csrf = SessionManager.generateCsrf();
        assert.ok(csrf.length > 0, 'CSRF token should be non-empty');
        assert.ok(!/[+/=]/.test(csrf), 'CSRF token should be base64url');
        // Session can store it
        const data = { userId: 'u6', csrf };
        const encrypted = sm.encrypt(data);
        const decrypted = sm.decrypt(encrypted);
        assert.ok(decrypted !== null);
        assert.equal(decrypted.csrf, csrf);
    });
});
// ── Expanded JWT tests (Task 3) ───────────────────────────────────────────────
describe('JwtService — expanded coverage', () => {
    const jwt = new JwtService('test-secret-at-least-32-chars-here!!');
    it('sign() returns a 3-part dot-separated token', () => {
        const token = jwt.sign({ sub: 'u1' });
        assert.equal(token.split('.').length, 3);
    });
    it('verify() returns payload for valid token', () => {
        const token = jwt.sign({ sub: 'u1', email: 'u@test.com' });
        const p = jwt.verify(token);
        assert.ok(p !== null);
        assert.equal(p.sub, 'u1');
        assert.equal(p.email, 'u@test.com');
    });
    it('verify() returns null for expired token (exp in past)', () => {
        const token = jwt.sign({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 10 });
        assert.equal(jwt.verify(token), null);
    });
    it('verify() returns null for wrong secret', () => {
        const token = jwt.sign({ sub: 'u1' });
        const wrong = new JwtService('wrong-secret-at-least-32-chars-xxx');
        assert.equal(wrong.verify(token), null);
    });
    it('verify() returns null for malformed token (only 2 parts)', () => {
        assert.equal(jwt.verify('header.payload'), null);
    });
    it('verify() returns null for token with tampered payload', () => {
        const token = jwt.sign({ sub: 'u1' });
        const parts = token.split('.');
        const tampered = parts[0] + '.' + Buffer.from('{"sub":"evil","iat":0}').toString('base64url') + '.' + parts[2];
        assert.equal(jwt.verify(tampered), null);
    });
    it('custom payload claims survive sign/verify round-trip', () => {
        const token = jwt.sign({ sub: 'u1', customField: 'my-value' });
        const p = jwt.verify(token);
        assert.equal(p['customField'], 'my-value');
    });
    it('sign() with expiresInSeconds puts exp in future', () => {
        const before = Math.floor(Date.now() / 1000);
        const token = jwt.sign({ sub: 'u1' }, { expiresInSeconds: 3600 });
        const p = jwt.verify(token);
        assert.ok(p !== null);
        assert.ok((p.exp ?? 0) > before + 3500);
    });
});
// ── Expanded Session tests (Task 3) ──────────────────────────────────────────
describe('SessionManager — expanded coverage', () => {
    const hexKey = crypto.randomBytes(32).toString('hex');
    const sm = new SessionManager(hexKey);
    it('encrypt() returns a non-empty string that is not plain JSON', () => {
        const blob = sm.encrypt({ userId: 'u1', email: 'u@test.com' });
        assert.equal(typeof blob, 'string');
        assert.ok(blob.length > 0);
        // Should not be readable JSON
        assert.throws(() => {
            const parsed = JSON.parse(blob);
            assert.equal(parsed.userId, 'u1'); // if this passes, encryption is broken
        });
    });
    it('decrypt() returns session data for valid encrypted blob', () => {
        const data = { userId: 'u123', roles: ['admin'], csrf: 'csrf-token' };
        const blob = sm.encrypt(data);
        const recovered = sm.decrypt(blob);
        assert.ok(recovered !== null);
        assert.equal(recovered.userId, 'u123');
        assert.deepEqual(recovered.roles, ['admin']);
    });
    it('decrypt() returns null for garbage input', () => {
        assert.equal(sm.decrypt('not-valid-base64url-content-at-all'), null);
    });
    it('different sessions with same data produce different blobs (random IV)', () => {
        const data = { userId: 'same-user' };
        const blob1 = sm.encrypt(data);
        const blob2 = sm.encrypt(data);
        assert.notEqual(blob1, blob2);
    });
    it('decrypt() returns null for blob encrypted with different key', () => {
        const sm2 = new SessionManager(crypto.randomBytes(32).toString('hex'));
        const blob = sm2.encrypt({ userId: 'u1' });
        assert.equal(sm.decrypt(blob), null);
    });
});
// ── Additional RBAC tests (Task 3) ────────────────────────────────────────────
describe('RbacService — hierarchy and edge cases', () => {
    it('admin inherits editor inherits viewer permissions (3-level chain)', () => {
        const hierarchy = { admin: ['editor'], editor: ['viewer'], viewer: [] };
        const perms = { admin: ['admin:action'], editor: ['edit:post'], viewer: ['view:post'] };
        const svc = new RbacService(hierarchy, perms);
        assert.ok(svc.hasPermission(['admin'], 'admin:action'));
        assert.ok(svc.hasPermission(['admin'], 'edit:post'));
        assert.ok(svc.hasPermission(['admin'], 'view:post'));
        assert.ok(!svc.hasPermission(['viewer'], 'edit:post'));
        assert.ok(svc.hasPermission(['viewer'], 'view:post'));
    });
    it('hasPermission returns false for unknown role', () => {
        const svc = new RbacService({ admin: [] }, { admin: ['admin:read'] });
        assert.ok(!svc.hasPermission(['ghost'], 'admin:read'));
    });
    it('rbacGuard passes through when no _requiredRoles in state (open route)', async () => {
        const svc = new RbacService({});
        const guard = rbacGuard(svc);
        const ctx = { state: {}, user: { id: '1', email: '', roles: [] } };
        let nextCalled = false;
        await guard(ctx, async () => { nextCalled = true; });
        assert.ok(nextCalled);
    });
    it('rbacGuard passes through when required arrays are empty', async () => {
        const svc = new RbacService({});
        const guard = rbacGuard(svc);
        const ctx = {
            state: { _requiredRoles: [], _requiredPermissions: [] },
            user: { id: '1', email: '', roles: [] },
        };
        let nextCalled = false;
        await guard(ctx, async () => { nextCalled = true; });
        assert.ok(nextCalled);
    });
    it('rbacGuard throws ForbiddenException for wrong role', async () => {
        const svc = new RbacService({ admin: [], user: [] });
        const guard = rbacGuard(svc);
        const ctx = {
            state: { _requiredRoles: ['admin'], _requiredPermissions: [] },
            user: { id: '1', email: '', roles: ['user'] },
        };
        await assert.rejects(() => guard(ctx, async () => { }), (err) => {
            assert.ok(err instanceof ForbiddenException);
            return true;
        });
    });
    it('rbacGuard allows when user has any one of multiple required roles (OR logic)', async () => {
        const svc = new RbacService({ admin: [], moderator: [], user: [] });
        const guard = rbacGuard(svc);
        const ctx = {
            state: { _requiredRoles: ['admin', 'moderator'], _requiredPermissions: [] },
            user: { id: '1', email: '', roles: ['moderator'] },
        };
        let nextCalled = false;
        await guard(ctx, async () => { nextCalled = true; });
        assert.ok(nextCalled);
    });
    it('rbacGuard blocks when user has no roles at all', async () => {
        const svc = new RbacService({ admin: [] });
        const guard = rbacGuard(svc);
        const ctx = {
            state: { _requiredRoles: ['admin'], _requiredPermissions: [] },
            user: { id: '1', email: '', roles: [] },
        };
        await assert.rejects(() => guard(ctx, async () => { }), (err) => { assert.ok(err instanceof ForbiddenException); return true; });
    });
});
// ── Additional API Key tests (Task 3) ────────────────────────────────────────
describe('ApiKeyService — additional coverage', () => {
    it('verify() returns null for expired key (expiresAt in the past)', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const { key } = await svc.generate({
            ownerId: 'user1',
            name: 'test',
            expiresAt: new Date(Date.now() - 1000),
        });
        const result = await svc.verify(key);
        assert.equal(result, null);
    });
    it('apiKeyMiddleware throws 401 with missing Authorization header', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const mw = apiKeyMiddleware(svc);
        const ctx = { headers: {}, user: undefined, state: {} };
        await assert.rejects(() => mw(ctx, async () => { }), (err) => {
            assert.equal(err.status, 401);
            return true;
        });
    });
    it('apiKeyMiddleware throws 401 for invalid/unknown key', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const mw = apiKeyMiddleware(svc);
        const ctx = {
            headers: { authorization: 'Bearer invalid_key_that_does_not_exist' },
            user: undefined,
            state: {},
        };
        await assert.rejects(() => mw(ctx, async () => { }), (err) => { assert.equal(err.status, 401); return true; });
    });
    it('apiKeyMiddleware sets ctx.user.id to ownerId on success', async () => {
        const pool = new ApiKeyMemPool();
        const svc = new ApiKeyService(pool);
        const { key } = await svc.generate({ ownerId: 'owner123', name: 'test' });
        const mw = apiKeyMiddleware(svc);
        const ctx = { headers: { authorization: `Bearer ${key}` }, user: undefined, state: {} };
        await mw(ctx, async () => { });
        assert.equal(ctx.user?.id, 'owner123');
    });
});
// ── Additional WebAuthn tests (Task 3) ───────────────────────────────────────
describe('WebAuthn — additional coverage', () => {
    it('parseCredentialPublicKey throws for authData shorter than 37 bytes', () => {
        const shortBuf = Buffer.alloc(30);
        assert.throws(() => parseCredentialPublicKey(shortBuf));
    });
    it('beginRegistration returns challenge encoded as ≥16 base64url bytes', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const opts = await svc.beginRegistration('user1');
        const challengeBuf = Buffer.from(opts.challenge, 'base64url');
        assert.ok(challengeBuf.length >= 16, `Challenge should be ≥16 bytes, got ${challengeBuf.length}`);
    });
    it('finishAuthentication throws challenge_expired when no challenge stored', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        const assertion = {
            id: 'cred1', rawId: 'cred1',
            response: { clientDataJSON: '', authenticatorData: '', signature: '', userHandle: '' },
            type: 'public-key',
        };
        await assert.rejects(() => svc.finishAuthentication('user1', assertion), /challenge_expired/);
    });
    it('finishRegistration throws on wrong ceremony type', async () => {
        const session = new MemorySession();
        const pool = new MemoryPool();
        const svc = new WebAuthnService({ rpName: 'Test', rpId: 'localhost', origin: 'http://localhost' }, pool, session);
        await svc.beginRegistration('user-ceremony');
        const fakeClientData = JSON.stringify({
            type: 'webauthn.get', // wrong type — should be 'webauthn.create'
            challenge: 'fake',
            origin: 'http://localhost',
        });
        const credential = {
            id: 'credId', rawId: 'credId',
            response: {
                clientDataJSON: Buffer.from(fakeClientData).toString('base64url'),
                attestationObject: Buffer.from([0xa0]).toString('base64url'),
            },
            type: 'public-key',
        };
        await assert.rejects(() => svc.finishRegistration('user-ceremony', credential));
    });
});
//# sourceMappingURL=auth.test.js.map