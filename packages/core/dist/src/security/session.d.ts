export interface SessionData {
    userId?: string;
    email?: string;
    roles?: string[];
    csrf?: string;
    [key: string]: unknown;
}
export declare class SessionManager {
    private readonly key;
    constructor(hexKey: string);
    /** Encrypt session data → base64 blob (iv + tag + ciphertext) */
    encrypt(data: SessionData): string;
    /** Decrypt session blob → SessionData or null if tampered/invalid */
    decrypt(blob: string): SessionData | null;
    /** Generate a cryptographically random CSRF token */
    static generateCsrf(): string;
    /** Generate a secure random session ID */
    static generateSessionId(): string;
}
//# sourceMappingURL=session.d.ts.map