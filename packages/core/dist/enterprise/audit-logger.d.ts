export declare const ENTERPRISE_AUDIT_MIGRATION_SQL = "\nCREATE TABLE IF NOT EXISTS street_audit_log (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  category TEXT NOT NULL,\n  actor_id TEXT,\n  action TEXT NOT NULL,\n  resource TEXT,\n  before_state JSONB,\n  after_state JSONB,\n  ip TEXT,\n  user_agent TEXT,\n  batch_id UUID,\n  signature TEXT,\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);\n";
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
}
/**
 * Property decorator that marks a field as sensitive, causing it to be
 * redacted in audit log output.
 */
export declare function Sensitive(): PropertyDecorator;
export interface GenericPool {
    query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
    }>;
}
export declare class AuditLogger {
    private readonly pool;
    private readonly signingKey;
    private readonly pendingBatch;
    private previousSignature;
    private flushTimer;
    constructor(opts: {
        pool: GenericPool;
        signingKey: string;
    });
    log(opts: AuditEntry): Promise<void>;
    private _flush;
    /**
     * Stream audit log entries between two dates as JSONL or CSV.
     */
    export(from: Date, to: Date, format: 'jsonl' | 'csv'): NodeJS.ReadableStream;
}
//# sourceMappingURL=audit-logger.d.ts.map