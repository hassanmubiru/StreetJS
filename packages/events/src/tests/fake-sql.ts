// src/tests/fake-sql.ts
// A tiny in-memory SqlExecutor that recognizes exactly the statement shapes the
// PostgresEventStore emits (CREATE/SELECT 1/INSERT/SELECT rows/DELETE). It does
// not parse SQL beyond the leading keyword — the store applies all filtering in
// process, so the fake only stores rows and returns them ordered by (seq,
// insertion), mirroring `ORDER BY seq ASC, store_seq ASC`. Test-only.

import type { SqlExecutor, SqlRow } from '../store/postgres.js';

interface StoredRow {
  id: string;
  name: string;
  payload: string; // JSON text (as jsonb comes back over the text protocol)
  ts: string;
  seq: string;
  metadata: string;
  storeSeq: number;
}

export class FakeSql implements SqlExecutor {
  private rows: StoredRow[] = [];
  private storeSeq = 0;
  /** Set to throw on the next query (to test error → health down). */
  failNext = false;

  query(text: string, params?: unknown[]): Promise<{ rows: SqlRow[] }> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('simulated postgres failure'));
    }
    const head = text.trimStart().slice(0, 6).toUpperCase();

    if (head.startsWith('CREATE') || text.trimStart().toUpperCase().startsWith('SELECT 1')) {
      return Promise.resolve({ rows: [] });
    }

    if (head.startsWith('INSERT')) {
      const p = params ?? [];
      this.rows.push({
        id: String(p[0]),
        name: String(p[1]),
        payload: String(p[2]),
        ts: String(p[3]),
        seq: String(p[4]),
        metadata: String(p[5]),
        storeSeq: this.storeSeq++,
      });
      return Promise.resolve({ rows: [] });
    }

    if (head.startsWith('DELETE')) {
      this.rows = [];
      return Promise.resolve({ rows: [] });
    }

    if (head.startsWith('SELECT')) {
      // Ordered by (seq ASC, storeSeq ASC), matching the store's ORDER BY.
      const ordered = [...this.rows].sort((a, b) => {
        const sa = Number(a.seq);
        const sb = Number(b.seq);
        return sa !== sb ? sa - sb : a.storeSeq - b.storeSeq;
      });
      const rows: SqlRow[] = ordered.map((r) => ({
        id: r.id,
        name: r.name,
        payload: r.payload,
        ts: r.ts,
        seq: r.seq,
        metadata: r.metadata,
      }));
      return Promise.resolve({ rows });
    }

    return Promise.resolve({ rows: [] });
  }
}
