export declare const WEBAUTHN_MIGRATION_SQL: string;
/** Decode a subset of CBOR used in WebAuthn attestation/assertion objects. */
export declare function decodeCbor(buf: Buffer): unknown;
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
export declare function parseCredentialPublicKey(authData: Buffer): string;
export interface WebAuthnConfig {
    rpName: string;
    rpId: string;
    origin: string;
    challengeExpiryMs?: number;
}
export interface PublicKeyCredentialCreationOptionsJSON {
    rp: {
        name: string;
        id: string;
    };
    user: {
        id: string;
        name: string;
        displayName: string;
    };
    challenge: string;
    pubKeyCredParams: Array<{
        type: string;
        alg: number;
    }>;
    timeout: number;
    attestation: string;
}
export interface PublicKeyCredentialRequestOptionsJSON {
    challenge: string;
    timeout: number;
    rpId: string;
    allowCredentials: Array<{
        type: string;
        id: string;
    }>;
    userVerification: string;
}
export interface RegistrationResponseJSON {
    id: string;
    rawId: string;
    response: {
        clientDataJSON: string;
        attestationObject: string;
    };
    type: string;
}
export interface AuthenticationResponseJSON {
    id: string;
    rawId: string;
    response: {
        clientDataJSON: string;
        authenticatorData: string;
        signature: string;
        userHandle?: string;
    };
    type: string;
}
export interface WebAuthnSession {
    getChallenge(userId: string): Promise<{
        challenge: string;
        expiresAt: number;
    } | null>;
    setChallenge(userId: string, challenge: string, expiresAt: number): Promise<void>;
    clearChallenge(userId: string): Promise<void>;
}
export interface WebAuthnPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, string | null>[];
        rowCount: number;
        command: string;
    }>;
}
export declare class WebAuthnService {
    private readonly _config;
    private readonly _pool;
    private readonly _session;
    constructor(config: WebAuthnConfig, pool: WebAuthnPool, session: WebAuthnSession);
    beginRegistration(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON>;
    finishRegistration(userId: string, credential: RegistrationResponseJSON): Promise<{
        credentialId: string;
    }>;
    beginAuthentication(userId: string): Promise<PublicKeyCredentialRequestOptionsJSON>;
    finishAuthentication(userId: string, assertion: AuthenticationResponseJSON): Promise<void>;
}
//# sourceMappingURL=webauthn.d.ts.map