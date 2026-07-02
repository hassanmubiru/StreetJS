// src/store/postgres.ts
// @streetjs/events — a durable, relational EventStore backed by PostgreSQL,
// opt-in via the `@streetjs/events/postgres` submodule. It depends only on a
// STRUCTURAL `SqlExecutor` (the core `PgPool` satisfies it), so it needs no new
// runtime dependency and works with any Postgres-compatible pool.
//
// Storage model (table `street_events`):
//   store_seq  BIGSERIAL PRIMARY KEY  — authoritative append order (monotonic
//                                       even across writers/restarts, where the
//                                       per-facade envelope `seq` would collide);
//   id         TEXT      — the event occurrence id;
//   name       TEXT      — the concrete event name;
//   payload    JSONB     — the typed payload;
//   ts         BIGINT    — publish timestamp (epoch ms);
//   seq        BIGINT    — the per-facade publish sequence;
//   metadata   JSONB     — event metadata.
//
// Rows are read ordered by (seq, store_seq); name/pattern/since/until/fromSeq
// filters and `limit` are applied in-process so semantics match MemoryEventStore
// / RedisEventStore exactly (the custom `*`/`**` wildcards are not expressible in
// SQL). This is an application event store, not a log warehouse.

import type { EventEnvelope } from '../event.js';
import { matchesPattern } from '../matcher.js';
import type { EventStore, ReplayFilter } from './store.js';

/** A row as returned by a Postgres text-protocol pool (values are strings). */
export type SqlRow = Record<string, string | null>;

/** The minimal pool surface this store needs. The core `PgPool` satisfies it. */
export interface SqlExecutor {
  query(text: string, params?: unknown[]): Promise<{ rows: SqlRow[] }>;
}

/** Options for {@link PostgresEventStore}. */
export interface PostgresEventStoreOptions {
  /** A Postgres-compatible pool (the core `PgPool`, or any `SqlExecutor`). */
  pool: SqlExecutor;
  /** Table name. Default `"street_events"`. */
  table?: string;
}

/**
 * The migration that creates the events table. Run it once during deploy, or via
 * {@link PostgresEventStore.init}. Idempotent (`IF NOT EXISTS`).
 */
export const POSTGRES_EVENTS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_events (
  store_seq  BIGSERIAL PRIMARY KEY,
  id         TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  payload    JSONB       NOT NULL,
  ts         BIGINT      NOT NULL,
  seq        BIGINT      NOT NULL,
  metadata   JSONB       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS street_events_name_idx ON street_events (name);
CREATE INDEX IF NOT EXISTS street_events_seq_idx  ON street_events (seq);
CREATE INDEX IF NOT EXISTS street_events_ts_idx   ON street_events (ts);
`.trim();

/** A durable {@link EventStore} over PostgreSQL. */
export class PostgresEventStore implements EventStore {
  private readonly pool: SqlExecutor;
  private readonly table: string;
  private healthy = false;

  constructor(options: PostgresEventStoreOptions) {
    this.pool = options.pool;
    // Guard the table identifier (no user input flows here, but be strict).
    const table = options.table ?? 'street_events';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      throw new Error(`PostgresEventStore: invalid table name "${table}".`);
    }
    this.table = table;
  }

  /**
   * Create the table (idempotent) and verify connectivity. Rejects if the
   * backend is unreachable. Uses the built-in migration for the default table;
   * for a custom table the migration is adapted to that name.
   */
  async init(): Promise<void> {
    const migration =
      this.table === 'street_events'
        ? POSTGRES_EVENTS_MIGRATION_SQL
        : POSTGRES_EVENTS_MIGRATION_SQL.replace(/street_events/g, this.table);
    await this.run(migration);
    await this.run('SELECT 1');
    this.healthy = true;
  }

  async append(envelope: EventEnvelope): Promise<void> {
    await this.run(
      `INSERT INTO ${this.table} (id, name, payload, ts, seq, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        envelope.id,
        envelope.name,
        JSON.stringify(envelope.payload ?? null),
        envelope.timestamp,
        envelope.seq,
        JSON.stringify(envelope.metadata ?? {}),
      ],
    );
    this.healthy = true;
  }

  async read(filter?: ReplayFilter): Promise<EventEnvelope[]> {
    // FUTURE (deferred, tracked): for very high volumes, push the non-wildcard
    // predicates down to SQL — `name` (equality), `since`/`until` (ts range),
    // `fromSeq` (seq >=), and `limit` (LIMIT) — keeping only the `*`/`**`
    // `pattern` match in-process. `limit` may only be pushed down when no
    // `pattern` is present, otherwise SQL would truncate before the in-process
    // wildcard filter and change results. Kept in-process here for exact parity
    // with MemoryEventStore; add live-DB parity tests when implementing.
    const { rows } = await this.run(
      `SELECT id, name, payload, ts, seq, metadata
       FROM ${this.table}
       ORDER BY seq ASC, store_seq ASC`,
    );
    this.healthy = true;
    const parsed: EventEnvelope[] = [];
    for (const row of rows) {
      const env = rowToEnvelope(row);
      if (env !== null && this.matches(env, filter)) {
        parsed.push(env);
      }
    }
    return filter?.limit !== undefined && filter.limit >= 0
      ? parsed.slice(0, filter.limit)
      : parsed;
  }

  async count(filter?: ReplayFilter): Promise<number> {
    return (await this.read(filter)).length;
  }

  async clear(): Promise<void> {
    await this.run(`DELETE FROM ${this.table}`);
    this.healthy = true;
  }

  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    return this.healthy
      ? { status: 'up' }
      : { status: 'down', details: { reason: 'postgres not verified reachable' } };
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  private async run(text: string, params?: unknown[]): Promise<{ rows: SqlRow[] }> {
    try {
      return await this.pool.query(text, params);
    } catch (err) {
      this.healthy = false;
      throw err;
    }
  }

  private matches(env: EventEnvelope, filter?: ReplayFilter): boolean {
    if (!filter) return true;
    if (filter.name !== undefined && env.name !== filter.name) return false;
    if (filter.pattern !== undefined && !matchesPattern(env.name, filter.pattern)) return false;
    if (filter.since !== undefined && env.timestamp < filter.since) return false;
    if (filter.until !== undefined && env.timestamp > filter.until) return false;
    if (filter.fromSeq !== undefined && env.seq < filter.fromSeq) return false;
    return true;
  }
}

/** Convert a text-protocol row into an {@link EventEnvelope}; null on bad data. */
function rowToEnvelope(row: SqlRow): EventEnvelope | null {
  const id = row['id'];
  const name = row['name'];
  if (id === null || id === undefined || name === null || name === undefined) {
    return null;
  }
  return {
    id,
    name,
    payload: parseJson(row['payload']),
    timestamp: Number(row['ts'] ?? 0),
    seq: Number(row['seq'] ?? 0),
    metadata: (parseJson(row['metadata']) as Record<string, unknown>) ?? {},
  };
}

/** Parse a JSONB column that may arrive as a string (text protocol) or object. */
function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value ?? null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
