import { PgPool } from './pool.js';
import type { PgConnection } from './wire.js';
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
    protected abstract mapRow(row: Record<string, string | null>): T;
    findById(id: string): Promise<T | null>;
    findAll(limit?: number, offset?: number): Promise<T[]>;
    count(): Promise<number>;
    create(data: Partial<T>): Promise<T>;
    update(id: string, data: Partial<T>): Promise<T | null>;
    delete(id: string): Promise<boolean>;
    /** Execute raw SQL within a transaction */
    withTransaction<R>(fn: (conn: PgConnection) => Promise<R>): Promise<R>;
    /** Stream rows with backpressure */
    streamAll(sql: string): import('./wire.js').StreetPostgresWireStream;
}
export declare class LedgerTransactionService {
    private readonly pool;
    constructor(pool: PgPool);
    execute<T>(operations: Array<(conn: PgConnection) => Promise<void>>, onSuccess?: () => Promise<T>): Promise<T | void>;
}
//# sourceMappingURL=repository.d.ts.map