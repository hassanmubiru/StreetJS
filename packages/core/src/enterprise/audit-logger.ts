// src/enterprise/audit-logger.ts
// Enterprise-grade audit logger with batching, HMAC hash-chain signing, and streaming export.

import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

export const ENTERPRISE_AUDIT_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  before_state JSONB,
  after_state JSONB,
  ip TEXT,
  user_agent TEXT,
  batch_id UUID,
  signature TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Append-only enforcement: reject any UPDATE or DELETE on the audit log so
-- entries can never be altered or removed once written (tamper-evidence).
CREATE OR REPLACE FUNCTION street_audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'street_audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS street_audit_log_no_update ON street_audit_log;
CREATE TRIGGER street_audit_log_no_update
  BEFORE UPDATE OR DELETE ON street_audit_log
  FOR EACH ROW EXECUTE FUNCTION street_audit_log_append_only();
`;

export type AuditCategory = 'auth' | 'data' | 'admin' | 'security';

export interface AuditEntry {
  category: AuditCategory;
  actorId?: string;
  action: string;
  resource?: string;
  beforeState?: unknown;
  afterState?: unknown;
  ip?: string;
  userAgent?: string;
  /**
   * Optional entity constructor whose `@Sensitive()` fields should be redacted
   * in `beforeState` / `afterState` before persistence.
   */
  entityClass?: new (...args: never[]) => unknown;
}

interface BatchEntry extends AuditEntry {
  id: string;
  batchId: string;
  createdAt: Date;
}

const BATCH_SIZE = 100;

/**
 * Property decorator that marks a field as sensitive, causing it to be
 * redacted in audit log output.
 */
export function Sensitive(): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    const existing: string[] =
      (Reflect.getMetadata('street:sensitive', target.constructor) as string[] | undefined) ?? [];
    existing.push(String(propertyKey));
    Reflect.defineMetadata('street:sensitive', existing, target.constructor);
  };
}

export interface GenericPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export class AuditLogger {
  private readonly pool: GenericPool;
  private readonly signingKey: string;
  private readonly pendingBatch: BatchEntry[] = [];
  private previousSignature = '';
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(opts: { pool: GenericPool; signingKey: string }) {
    this.pool = opts.pool;
    this.signingKey = opts.signingKey;
  }

  async log(opts: AuditEntry): Promise<void> {
    const entry: BatchEntry = {
      ...opts,
      beforeState: _redactSensitive(opts.beforeState, opts.entityClass),
      afterState: _redactSensitive(opts.afterState, opts.entityClass),
      id: _uuid(),
      batchId: '',       // assigned at flush time
      createdAt: new Date(),
    };

    this.pendingBatch.push(entry);

    if (this.pendingBatch.length >= BATCH_SIZE) {
      await this._flush();
    } else if (!this.flushTimer) {
      // Auto-flush after 5s for low-volume scenarios
      this.flushTimer = setTimeout(() => {
        this._flush().catch(() => undefined);
      }, 5_000);
      this.flushTimer.unref();
    }
  }

  /** Force-flush any pending entries to the database. */
  async flush(): Promise<void> {
    await this._flush();
  }

  private async _flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pendingBatch.length === 0) return;

    const batchId = _uuid();
    const entries = this.pendingBatch.splice(0, this.pendingBatch.length);

    for (const entry of entries) {
      entry.batchId = batchId;
    }

    const batchJSON = JSON.stringify(entries);
    const signature = createHmac('sha256', this.signingKey)
      .update(this.previousSignature + batchJSON)
      .digest('hex');

    this.previousSignature = signature;

    for (const entry of entries) {
      await this.pool.query(
        `INSERT INTO street_audit_log
          (id, category, actor_id, action, resource, before_state, after_state,
           ip, user_agent, batch_id, signature, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          entry.id,
          entry.category,
          entry.actorId ?? null,
          entry.action,
          entry.resource ?? null,
          entry.beforeState ? JSON.stringify(entry.beforeState) : null,
          entry.afterState ? JSON.stringify(entry.afterState) : null,
          entry.ip ?? null,
          entry.userAgent ?? null,
          batchId,
          signature,
          entry.createdAt.toISOString(),
        ]
      );
    }
  }

  /**
   * Stream audit log entries between two dates as JSONL or CSV.
   */
  export(from: Date, to: Date, format: 'jsonl' | 'csv'): NodeJS.ReadableStream {
    const pool = this.pool;
    let started = false;

    const readable = new Readable({
      objectMode: false,
      read() {
        if (started) return;
        started = true;

        (async () => {
          try {
            if (format === 'csv') {
              readable.push(
                'id,category,actor_id,action,resource,ip,user_agent,batch_id,signature,created_at\n'
              );
            }

            // Stream rows in pages of 500
            let offset = 0;
            const pageSize = 500;
            let hasMore = true;

            while (hasMore) {
              const result = await pool.query(
                `SELECT id, category, actor_id, action, resource,
                        before_state, after_state, ip, user_agent,
                        batch_id, signature, created_at
                 FROM street_audit_log
                 WHERE created_at >= $1 AND created_at <= $2
                 ORDER BY created_at ASC
                 LIMIT $3 OFFSET $4`,
                [from.toISOString(), to.toISOString(), pageSize, offset]
              );

              for (const row of result.rows) {
                if (format === 'jsonl') {
                  readable.push(JSON.stringify(row) + '\n');
                } else {
                  readable.push(_rowToCsv(row) + '\n');
                }
              }

              offset += result.rows.length;
              hasMore = result.rows.length === pageSize;
            }

            readable.push(null);
          } catch (err) {
            readable.destroy(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      },
    });

    return readable;
  }
}

function _redactSensitive(state: unknown, entityClass?: new (...args: never[]) => unknown): unknown {
  if (!entityClass || state === null || typeof state !== 'object') return state;
  const sensitive = (Reflect.getMetadata('street:sensitive', entityClass) as string[] | undefined) ?? [];
  if (sensitive.length === 0) return state;
  const out: Record<string, unknown> = { ...(state as Record<string, unknown>) };
  for (const field of sensitive) {
    if (field in out) out[field] = '[REDACTED]';
  }
  return out;
}

function _uuid(): string {
  // Generate a v4 UUID using crypto.randomUUID if available, else fallback
  if (typeof crypto !== 'undefined' && typeof (crypto as { randomUUID?: () => string }).randomUUID === 'function') {
    return (crypto as { randomUUID: () => string }).randomUUID();
  }
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function _rowToCsv(row: Record<string, unknown>): string {
  const fields = [
    'id', 'category', 'actor_id', 'action', 'resource',
    'ip', 'user_agent', 'batch_id', 'signature', 'created_at',
  ];
  return fields
    .map((f) => {
      const v = row[f];
      if (v === null || v === undefined) return '';
      const str = String(v);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    })
    .join(',');
}
