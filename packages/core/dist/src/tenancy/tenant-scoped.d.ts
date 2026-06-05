import type { TenantContextData } from './context.js';
type GenericPool = {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
        rowCount: number;
        command: string;
    }>;
};
/**
 * Base class for tenant-scoped repositories.
 * All SELECT, INSERT, UPDATE, DELETE operations automatically include
 * the `tenant_id` constraint derived from the current tenant context.
 */
export declare class TenantScopedRepository<T extends Record<string, unknown>> {
    protected readonly pool: GenericPool;
    protected readonly tableName: string;
    private _tenant;
    constructor(pool: GenericPool, tableName: string);
    /** Set the current tenant context. Called by middleware or @TenantScoped decorator. */
    setTenant(tenant: TenantContextData): void;
    /** Get the current tenant ID; throws if no tenant context has been set. */
    protected get tenantId(): string;
    /** Find a single record by primary key, scoped to the current tenant. */
    findById(id: string): Promise<T | null>;
    /** Find all records belonging to the current tenant. */
    findAll(where?: Partial<T>): Promise<T[]>;
    /** Insert a new record, automatically setting tenant_id. */
    create(data: Omit<T, 'tenant_id' | 'id'> & {
        id?: string;
    }): Promise<T>;
    /** Update a record by ID, scoped to the current tenant. */
    update(id: string, data: Partial<T>): Promise<T | null>;
    /** Delete a record by ID, scoped to the current tenant. Returns true if deleted. */
    delete(id: string): Promise<boolean>;
}
/**
 * Class decorator that marks a repository as tenant-scoped.
 * Works with classes that extend `TenantScopedRepository`.
 * Stores metadata under `street:tenantScoped` for runtime inspection.
 */
export declare function TenantScoped(): ClassDecorator;
export {};
//# sourceMappingURL=tenant-scoped.d.ts.map