export type DataClassificationLevel = 'public' | 'internal' | 'confidential' | 'restricted';
/**
 * Marks a property with a retention duration (e.g. '90d', '1y').
 * Metadata key: 'street:retention'
 */
export declare function RetainFor(duration: string): PropertyDecorator;
/**
 * Marks a property for transparent AES-256-GCM field-level encryption.
 * Metadata key: 'street:encrypt'
 */
export declare function Encrypt(): PropertyDecorator;
/**
 * Marks a property with a data classification level.
 * Metadata key: 'street:classify'
 */
export declare function Classify(level: DataClassificationLevel): PropertyDecorator;
export interface GenericPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
    }>;
}
export interface RetentionEntityMeta {
    table: string;
    retentionDays: number;
}
/**
 * Deletes rows older than the specified retention period in batches.
 */
export declare class RetentionJob {
    private readonly pool;
    private readonly batchSize;
    constructor(pool: GenericPool, batchSize?: number);
    run(entityMeta: RetentionEntityMeta[]): Promise<void>;
    private _deleteForTable;
}
/**
 * Transparent field-level encryption for entity objects. Fields marked with
 * `@Encrypt()` are encrypted with AES-256-GCM before persistence and decrypted
 * on retrieval. The repository layer calls `encryptEntity()` in `create()` /
 * `update()` and `decryptEntity()` in `findById()` / `findAll()`.
 *
 * The ciphertext envelope is `enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>` so it
 * is self-describing and idempotent (already-encrypted values are passed
 * through unchanged, and decryption of a non-envelope value is a no-op).
 */
export declare class FieldEncryptor {
    private readonly key;
    private static readonly PREFIX;
    /** @param key 32-byte key, or any string/Buffer (hashed to 32 bytes via SHA-256). */
    constructor(key: string | Buffer);
    /** Encrypt a single string value into the self-describing envelope. */
    encryptValue(plaintext: string): string;
    /** Decrypt an envelope value; non-envelope values are returned unchanged. */
    decryptValue(value: string): string;
    private static encryptedFields;
    /** Return a copy of `obj` with all `@Encrypt()` string fields encrypted. */
    encryptEntity<T extends Record<string, unknown>>(entityClass: new (...a: never[]) => unknown, obj: T): T;
    /** Return a copy of `obj` with all `@Encrypt()` fields decrypted. */
    decryptEntity<T extends Record<string, unknown>>(entityClass: new (...a: never[]) => unknown, obj: T): T;
}
/**
 * Redact entity fields whose `@Classify()` level is at or above the configured
 * threshold (default from `LOG_CLASSIFICATION_THRESHOLD`, falling back to
 * `confidential`). Used by the logger to keep classified data out of log sinks.
 * Returns a shallow copy with offending fields replaced by `"[REDACTED]"`.
 */
export declare function redactByClassification<T extends Record<string, unknown>>(entityClass: new (...a: never[]) => unknown, obj: T, threshold?: DataClassificationLevel): T;
export interface ComplianceReport {
    field: string;
    entity: string;
    classification?: DataClassificationLevel;
    encrypted: boolean;
    retentionPeriod?: string;
}
export declare class ComplianceReporter {
    static report(entities: (new () => unknown)[]): ComplianceReport[];
}
//# sourceMappingURL=data-policy.d.ts.map