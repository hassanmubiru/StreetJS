import { PgPool } from './pool.js';
import type { PgConnection } from './wire.js';
import type { FieldEncryptor } from '../enterprise/data-policy.js';
export interface IRepository<T> {
    findById(id: string): Promise<T | null>;
    findAll(limit: number, offset: number): Promise<T[]>;
    create(data: Partial<T>): Promise<T>;
    update(id: string, data: Partial<T>): Promise<T | null>;
    delete(id: string): Promise<boolean>;
    count(): Promise<number>;
}
export declare abstract class StreetPostgresRepository<T extends object> implements IRepository<T> {
    protected readonly pool: PgPool;
    protected abstract readonly tableName: string;
    constructor(pool: PgPool);
    /** Validate tableName on first use (abstract property not available in constructor) */
    private _assertSafeTableName;
    protected abstract mapRow(row: Record<string, string | null>): T;
    /**
     * Optional transparent field-level encryption. Subclasses that set both
     * `encryptor` and `encryptedEntity` get automatic AES-256-GCM encryption of
     * `@Encrypt()`-annotated fields on `create()`/`update()` and decryption on
     * `findById()`/`findAll()`. Defaults to undefined (no encryption).
     */
    protected readonly encryptor?: FieldEncryptor;
    protected readonly encryptedEntity?: new (...a: never[]) => unknown;
    private _encrypt;
    private _decrypt;
    findById(id: string): Promise<T | null>;
    findAll(limit?: number, offset?: number): Promise<T[]>;
    count(): Promise<number>;
    create(data: Partial<T>): Promise<T>;
    update(id: string, data: Partial<T>): Promise<T | null>;
    delete(id: string): Promise<boolean>;
    /** Execute raw SQL within a transaction */
    withTransaction<R>(fn: (conn: PgConnection) => Promise<R>): Promise<R>;
    /** Stream rows with backpressure.
     * Finding 6 fix: accepts parameterized queries only — raw SQL without
     * params is still possible but callers should always use $1..$N placeholders.
     * The method signature now accepts params to discourage raw interpolation.
     */
    streamAll(sql: string, params?: unknown[]): Promise<import('./wire.js').StreetPostgresWireStream>;
}
export declare class LedgerTransactionService {
    private readonly pool;
    constructor(pool: PgPool);
    execute<T>(operations: Array<(conn: PgConnection) => Promise<void>>, onSuccess?: () => Promise<T>): Promise<T | void>;
}
//# sourceMappingURL=repository.d.ts.map