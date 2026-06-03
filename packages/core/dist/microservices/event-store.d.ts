export declare const EVENTS_MIGRATION_SQL = "CREATE TABLE IF NOT EXISTS street_events (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  aggregate_id TEXT NOT NULL,\n  version INT NOT NULL,\n  type TEXT NOT NULL,\n  payload JSONB NOT NULL,\n  created_at TIMESTAMPTZ DEFAULT NOW(),\n  UNIQUE (aggregate_id, version)\n);";
export interface DomainEvent {
    aggregateId: string;
    version: number;
    type: string;
    payload: unknown;
}
type GenericPool = {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
        rowCount: number;
        command: string;
    }>;
};
export declare class EventStore {
    private readonly _pool;
    constructor(_pool: GenericPool);
    /**
     * Append events to the event store for a given aggregate.
     *
     * Supports optimistic concurrency: if `expectedVersion` is provided,
     * the current max version for the aggregate must equal it.
     *
     * @param aggregateId      The aggregate's ID.
     * @param events           Events to append (without aggregateId).
     * @param expectedVersion  The expected current version (optional).
     */
    append(aggregateId: string, events: Omit<DomainEvent, 'aggregateId'>[], expectedVersion?: number): Promise<void>;
    /**
     * Load events for an aggregate, optionally starting from a given version.
     *
     * @param aggregateId  The aggregate's ID.
     * @param fromVersion  The minimum version to load (inclusive). Default: 0.
     * @returns            Events ordered by version ascending.
     */
    load(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]>;
}
export {};
//# sourceMappingURL=event-store.d.ts.map