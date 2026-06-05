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