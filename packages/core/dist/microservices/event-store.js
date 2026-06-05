// src/microservices/event-store.ts
// Event sourcing store with optimistic concurrency control.
// ── Migration SQL ──────────────────────────────────────────────────────────────
export const EVENTS_MIGRATION_SQL = `CREATE TABLE IF NOT EXISTS street_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id TEXT NOT NULL,
  version INT NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (aggregate_id, version)
);`;
// ── EventStore ────────────────────────────────────────────────────────────────
export class EventStore {
    _pool;
    constructor(_pool) {
        this._pool = _pool;
    }
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
    async append(aggregateId, events, expectedVersion) {
        if (events.length === 0)
            return;
        // Check current version for optimistic concurrency
        const versionResult = await this._pool.query(`SELECT COALESCE(MAX(version), -1) AS current_version FROM street_events WHERE aggregate_id = $1`, [aggregateId]);
        const currentVersion = Number(versionResult.rows[0]?.['current_version'] ?? -1);
        if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
            throw new Error(`EventStore: optimistic concurrency conflict for aggregate "${aggregateId}". ` +
                `Expected version ${expectedVersion} but found ${currentVersion}.`);
        }
        // Assign sequential version numbers starting from currentVersion + 1
        let nextVersion = currentVersion + 1;
        for (const event of events) {
            await this._pool.query(`INSERT INTO street_events (aggregate_id, version, type, payload)
         VALUES ($1, $2, $3, $4)`, [aggregateId, event.version ?? nextVersion, event.type, JSON.stringify(event.payload)]);
            nextVersion++;
        }
    }
    /**
     * Load events for an aggregate, optionally starting from a given version.
     *
     * @param aggregateId  The aggregate's ID.
     * @param fromVersion  The minimum version to load (inclusive). Default: 0.
     * @returns            Events ordered by version ascending.
     */
    async load(aggregateId, fromVersion = 0) {
        const result = await this._pool.query(`SELECT aggregate_id, version, type, payload
       FROM street_events
       WHERE aggregate_id = $1 AND version >= $2
       ORDER BY version ASC`, [aggregateId, fromVersion]);
        return result.rows.map((row) => {
            const r = row;
            return {
                aggregateId: r['aggregate_id'],
                version: Number(r['version']),
                type: r['type'],
                payload: typeof r['payload'] === 'string' ? JSON.parse(r['payload']) : r['payload'],
            };
        });
    }
}
//# sourceMappingURL=event-store.js.map