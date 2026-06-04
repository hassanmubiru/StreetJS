// src/auth/webauthn.ts
// WebAuthn Level 2 registration and authentication ceremonies.
// Uses node:crypto (createVerify, randomBytes) — zero external dependencies.
// Includes a minimal CBOR decoder for attestation/assertion objects.
import * as crypto from 'node:crypto';
// ── Migration SQL ─────────────────────────────────────────────────────────────
export const WEBAUTHN_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_webauthn_credentials (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id        TEXT NOT NULL,
  credential_id  TEXT NOT NULL UNIQUE,
  public_key     TEXT NOT NULL,
  sign_count     BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_webauthn_cred_user_idx ON street_webauthn_credentials (user_id);
`.trim();
// ── Minimal CBOR decoder ──────────────────────────────────────────────────────
/** Decode a subset of CBOR used in WebAuthn attestation/assertion objects. */
export function decodeCbor(buf) {
    const [value] = _decodeCborItem(buf, 0);
    return value;
}
function _decodeCborItem(buf, offset) {
    if (offset >= buf.length)
        throw new Error('CBOR: unexpected end of buffer');
    const initial = buf[offset];
    const majorType = (initial >> 5) & 0x07;
    const additionalInfo = initial & 0x1f;
    offset += 1;
    let value;
    if (additionalInfo <= 23) {
        value = additionalInfo;
    }
    else if (additionalInfo === 24) {
        value = buf[offset];
        offset += 1;
    }
    else if (additionalInfo === 25) {
        value = buf.readUInt16BE(offset);
        offset += 2;
    }
    else if (additionalInfo === 26) {
        value = buf.readUInt32BE(offset);
        offset += 4;
    }
    else if (additionalInfo === 27) {
        value = buf.readBigUInt64BE(offset);
        offset += 8;
    }
    else {
        value = 0;
    }
    switch (majorType) {
        case 0: return [value, offset]; // unsigned int
        case 1: return [-(Number(value) + 1), offset]; // negative int
        case 2: { // byte string
            const len = Number(value);
            const bytes = buf.subarray(offset, offset + len);
            return [bytes, offset + len];
        }
        case 3: { // text string
            const len = Number(value);
            const text = buf.toString('utf8', offset, offset + len);
            return [text, offset + len];
        }
        case 4: { // array
            const count = Number(value);
            const arr = [];
            for (let i = 0; i < count; i++) {
                const [item, next] = _decodeCborItem(buf, offset);
                arr.push(item);
                offset = next;
            }
            return [arr, offset];
        }
        case 5: { // map
            const count = Number(value);
            const map = {};
            for (let i = 0; i < count; i++) {
                const [k, next1] = _decodeCborItem(buf, offset);
                offset = next1;
                const [v, next2] = _decodeCborItem(buf, offset);
                offset = next2;
                map[String(k)] = v;
            }
            return [map, offset];
        }
        default:
            return [null, offset];
    }
}
// ── COSE key parsing ──────────────────────────────────────────────────────────
/**
 * Parse the COSE-encoded credential public key from authData and return a
 * JWK JSON string suitable for storage and later import via
 * crypto.createPublicKey({ key: jwk, format: 'jwk' }).
 *
 * authData layout:
 *   0-31   rpIdHash (32 bytes)
 *   32     flags (1 byte)
 *   33-36  signCount (4 bytes, big-endian)
 *   37-52  aaguid (16 bytes)   — only when AT flag (0x40) is set
 *   53-54  credentialIdLength (2 bytes, big-endian)
 *   55..   credentialId (credentialIdLength bytes)
 *   after  credentialPublicKey (CBOR-encoded COSE key)
 */
export function parseCredentialPublicKey(authData) {
    if (authData.length < 37)
        throw new Error('authData too short');
    const flags = authData[32];
    const hasAttestedCredential = (flags & 0x40) !== 0;
    if (!hasAttestedCredential)
        throw new Error('No attested credential data in authData');
    let offset = 37;
    // Skip aaguid (16 bytes)
    offset += 16;
    // Read credential ID length
    if (offset + 2 > authData.length)
        throw new Error('authData truncated at credentialIdLength');
    const credIdLen = authData.readUInt16BE(offset);
    offset += 2;
    // Skip credential ID
    offset += credIdLen;
    // Remaining bytes are the COSE key
    if (offset >= authData.length)
        throw new Error('No COSE key in authData');
    const coseKeyBytes = authData.subarray(offset);
    // Decode COSE key CBOR
    const coseKey = decodeCbor(Buffer.from(coseKeyBytes));
    const kty = coseKey['1'];
    if (kty === 2) {
        // EC2 key (kty=2, alg=-7 / ES256, crv=1 / P-256)
        const x = coseKey['-2'];
        const y = coseKey['-3'];
        if (!x || !y)
            throw new Error('Invalid EC2 COSE key: missing x or y');
        const jwk = {
            kty: 'EC',
            crv: 'P-256',
            x: x.toString('base64url'),
            y: y.toString('base64url'),
        };
        return JSON.stringify(jwk);
    }
    else if (kty === 3) {
        // RSA key (kty=3, alg=-257 / RS256)
        const n = coseKey['-1'];
        const e = coseKey['-2'];
        if (!n || !e)
            throw new Error('Invalid RSA COSE key: missing n or e');
        const jwk = {
            kty: 'RSA',
            n: n.toString('base64url'),
            e: e.toString('base64url'),
        };
        return JSON.stringify(jwk);
    }
    else {
        throw new Error(`Unsupported COSE key type: ${kty}`);
    }
}
// ── WebAuthnService ───────────────────────────────────────────────────────────
export class WebAuthnService {
    _config;
    _pool;
    _session;
    constructor(config, pool, session) {
        this._config = {
            rpName: config.rpName,
            rpId: config.rpId,
            origin: config.origin,
            challengeExpiryMs: config.challengeExpiryMs ?? 60_000,
        };
        this._pool = pool;
        this._session = session;
    }
    async beginRegistration(userId) {
        const challenge = crypto.randomBytes(32).toString('base64url');
        const expiresAt = Date.now() + this._config.challengeExpiryMs;
        await this._session.setChallenge(userId, challenge, expiresAt);
        return {
            rp: { name: this._config.rpName, id: this._config.rpId },
            user: { id: Buffer.from(userId).toString('base64url'), name: userId, displayName: userId },
            challenge,
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256
            timeout: this._config.challengeExpiryMs,
            attestation: 'none',
        };
    }
    async finishRegistration(userId, credential) {
        const sessionData = await this._session.getChallenge(userId);
        if (!sessionData)
            throw new Error('challenge_expired');
        if (Date.now() > sessionData.expiresAt) {
            await this._session.clearChallenge(userId);
            throw new Error('challenge_expired');
        }
        // Decode clientDataJSON
        const clientData = JSON.parse(Buffer.from(credential.response.clientDataJSON, 'base64url').toString('utf8'));
        if (clientData.type !== 'webauthn.create')
            throw new Error('Invalid ceremony type');
        if (clientData.challenge !== sessionData.challenge)
            throw new Error('Challenge mismatch');
        if (clientData.origin !== this._config.origin)
            throw new Error('Origin mismatch');
        // Decode attestation object (CBOR)
        const attestationBuf = Buffer.from(credential.response.attestationObject, 'base64url');
        const attestation = decodeCbor(attestationBuf);
        // Parse authData
        const authData = attestation['authData'];
        const credentialId = credential.id;
        // Parse COSE public key from authData and store as JWK JSON string
        const publicKey = parseCredentialPublicKey(authData);
        const signCount = authData.length >= 41 ? authData.readUInt32BE(33) : 0;
        await this._pool.query(`INSERT INTO street_webauthn_credentials (user_id, credential_id, public_key, sign_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (credential_id) DO UPDATE SET sign_count = $4`, [userId, credentialId, publicKey, signCount]);
        await this._session.clearChallenge(userId);
        return { credentialId };
    }
    async beginAuthentication(userId) {
        const challenge = crypto.randomBytes(32).toString('base64url');
        const expiresAt = Date.now() + this._config.challengeExpiryMs;
        await this._session.setChallenge(userId, challenge, expiresAt);
        const creds = await this._pool.query('SELECT credential_id FROM street_webauthn_credentials WHERE user_id = $1', [userId]);
        return {
            challenge,
            timeout: this._config.challengeExpiryMs,
            rpId: this._config.rpId,
            allowCredentials: creds.rows.map((r) => ({ type: 'public-key', id: r['credential_id'] ?? '' })),
            userVerification: 'preferred',
        };
    }
    async finishAuthentication(userId, assertion) {
        const sessionData = await this._session.getChallenge(userId);
        if (!sessionData)
            throw new Error('challenge_expired');
        if (Date.now() > sessionData.expiresAt) {
            await this._session.clearChallenge(userId);
            throw new Error('challenge_expired');
        }
        // Decode clientDataJSON
        const clientData = JSON.parse(Buffer.from(assertion.response.clientDataJSON, 'base64url').toString('utf8'));
        if (clientData.type !== 'webauthn.get')
            throw new Error('Invalid ceremony type');
        if (clientData.challenge !== sessionData.challenge)
            throw new Error('Challenge mismatch');
        if (clientData.origin !== this._config.origin)
            throw new Error('Origin mismatch');
        // Get stored credential
        const result = await this._pool.query('SELECT id, public_key, sign_count FROM street_webauthn_credentials WHERE credential_id = $1 AND user_id = $2', [assertion.id, userId]);
        const cred = result.rows[0];
        if (!cred)
            throw new Error('Credential not found');
        const storedSignCount = parseInt(cred['sign_count'] ?? '0', 10);
        // Parse authenticator data to get sign count
        const authData = Buffer.from(assertion.response.authenticatorData, 'base64url');
        const newSignCount = authData.length >= 41 ? authData.readUInt32BE(33) : 0;
        // Replay protection: new sign count must be greater than stored
        if (newSignCount !== 0 && newSignCount <= storedSignCount) {
            throw new Error('Sign count replay detected');
        }
        // Reconstruct signed data: authData || SHA-256(clientDataJSON)
        const signature = Buffer.from(assertion.response.signature, 'base64url');
        const clientDataHash = crypto.createHash('sha256')
            .update(Buffer.from(assertion.response.clientDataJSON, 'base64url'))
            .digest();
        const signedData = Buffer.concat([authData, clientDataHash]);
        // Load stored JWK and verify signature — any failure is a hard error
        const storedPublicKey = cred['public_key'];
        if (!storedPublicKey)
            throw new Error('Stored credential has no public key');
        const jwk = JSON.parse(storedPublicKey);
        const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
        const verifier = crypto.createVerify('SHA256');
        verifier.update(signedData);
        if (!verifier.verify(pubKey, signature)) {
            throw new Error('Invalid assertion signature');
        }
        // Update sign count
        await this._pool.query('UPDATE street_webauthn_credentials SET sign_count = $1 WHERE id = $2', [newSignCount, cred['id']]);
        await this._session.clearChallenge(userId);
    }
}
//# sourceMappingURL=webauthn.js.map