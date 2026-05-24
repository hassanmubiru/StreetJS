/** Encrypt a plaintext value using the KEK */
export declare function encryptSecret(plaintext: string, kek: string): string;
/** Decrypt a vault-encrypted value using the KEK */
export declare function decryptSecret(blob: string, kek: string): string;
/** Populate @Config-decorated fields on a class instance from environment variables */
export declare function loadConfig<T extends object>(instance: T, kek?: string): T;
/** Verify two secrets are equal in constant time */
export declare function constantTimeEqual(a: string, b: string): boolean;
//# sourceMappingURL=vault.d.ts.map