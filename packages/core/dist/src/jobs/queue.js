// src/jobs/queue.ts
// PostgreSQL-backed job queue with polling, class-decorator support, and retry policies.
import 'reflect-metadata';
// ── Migration SQL ─────────────────────────────────────────────────────────────
export const STREET_JOBS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pending',
  attempt_count INT NOT NULL DEFAULT 0,
  run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  worker_id    TEXT,
  locked_at    TIMESTAMPTZ,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS street_jobs_status_run_at ON street_jobs (status, run_at);
`;
export const STREET_DLQ_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_dead_letter_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       TEXT,
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  error        TEXT,
  exhausted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;
// ── @Job decorator ────────────────────────────────────────────────────────────
const JOB_TYPE_META = 'street:jobType';
/**
 * Class decorator that marks a class as a job handler for the given type.
 * The class must implement `execute(payload, ctx): Promise<void>`.
 */
export function Job(type) {
    return (target) => {
        Reflect.defineMetadata(JOB_TYPE_META, type, target);
    };
}
// ── JobQueue ──────────────────────────────────────────────────────────────────
export class JobQueue {
    pool;
    concurrency;
    pollIntervalMs;
    workerId;
    handlers = new Map();
    retryPolicies = new Map();
    timer = null;
    constructor(pool, opts) {
        this.pool = pool;
        this.concurrency = opts?.concurrency ?? 5;
        this.pollIntervalMs = opts?.pollIntervalMs ?? 1_000;
        this.workerId = opts?.workerId ?? `worker-${process.pid}`;
    }
    /** Enqueue a new job, returning the generated job id. */
    async enqueue(opts) {
        const { type, payload = {}, runAt } = opts;
        const result = await this.pool.query(`INSERT INTO street_jobs (type, payload, run_at)
       VALUES ($1, $2::jsonb, $3)
       RETURNING id`, [type, JSON.stringify(payload), runAt ?? new Date()]);
        return result.rows[0]['id'];
    }
    /** Register a handler function for the given job type. */
    register(type, handler) {
        this.handlers.set(type, handler);
    }
    /**
     * Register a class as a job handler.
     * The class must be decorated with @Job('type') and implement execute().
     */
    registerClass(ctor) {
        const type = Reflect.getMetadata(JOB_TYPE_META, ctor);
        if (!type) {
            throw new Error(`Cannot registerClass: class ${ctor.name} is not decorated with @Job(type)`);
        }
        const instance = new ctor();
        this.handlers.set(type, (payload, ctx) => instance.execute(payload, ctx));
    }
    /** Set a retry policy for a specific job type. */
    setRetryPolicy(type, policy) {
        this.retryPolicies.set(type, policy);
    }
    /** Start the polling loop. */
    start() {
        if (this.timer !== null)
            return;
        this.timer = setInterval(() => {
            void this._poll();
        }, this.pollIntervalMs);
        // Allow Node.js to exit even if the interval is still active
        this.timer.unref();
    }
    /** Stop the polling loop. */
    stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    // ── Internal ────────────────────────────────────────────────────────────────
    async _poll() {
        let rows;
        try {
            const result = await this.pool.query(`SELECT id, type, payload, attempt_count
         FROM street_jobs
         WHERE status = 'pending' AND run_at <= NOW()
         ORDER BY run_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1`, [this.concurrency]);
            rows = result.rows;
        }
        catch {
            // DB unavailable — skip this tick
            return;
        }
        await Promise.all(rows.map((row) => this._dispatch(row)));
    }
    async _dispatch(row) {
        const jobId = row['id'];
        const type = row['type'];
        const attempt = parseInt(row['attempt_count'], 10);
        // Lock the job
        try {
            await this.pool.query(`UPDATE street_jobs SET status='running', worker_id=$1, locked_at=NOW() WHERE id=$2`, [this.workerId, jobId]);
        }
        catch {
            return;
        }
        const handler = this.handlers.get(type);
        if (!handler) {
            // No handler registered — move straight to DLQ behaviour (treat as permanent failure)
            await this._handleFailure(jobId, type, row, attempt, new Error(`No handler registered for job type "${type}"`));
            return;
        }
        let payload;
        try {
            payload = JSON.parse(row['payload']);
        }
        catch {
            payload = {};
        }
        try {
            await handler(payload, { jobId, attempt });
            // Success — delete the job
            await this.pool.query(`DELETE FROM street_jobs WHERE id=$1`, [jobId]);
        }
        catch (err) {
            await this._handleFailure(jobId, type, row, attempt, err instanceof Error ? err : new Error(String(err)));
        }
    }
    async _handleFailure(jobId, type, row, attempt, err) {
        const policy = this.retryPolicies.get(type);
        const maxAttempts = policy?.maxAttempts ?? 1;
        const newAttemptCount = attempt + 1;
        if (newAttemptCount >= maxAttempts) {
            // Move to DLQ
            await this._moveToDlq(jobId, type, row, err);
        }
        else {
            // Compute backoff delay
            const delay = policy
                ? Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt), policy.maxDelayMs)
                : 0;
            await this.pool.query(`UPDATE street_jobs
         SET status='pending', attempt_count=$1, error=$2,
             run_at=NOW() + ($3 || ' milliseconds')::interval, worker_id=NULL, locked_at=NULL
         WHERE id=$4`, [newAttemptCount, err.message, String(delay), jobId]);
        }
    }
    async _moveToDlq(jobId, type, row, err) {
        try {
            await this.pool.transaction(async (conn) => {
                await conn.query(`INSERT INTO street_dead_letter_queue (job_id, type, payload, error)
           VALUES ($1, $2, $3::jsonb, $4)`, [jobId, type, row['payload'] ?? '{}', err.message]);
                await conn.query(`DELETE FROM street_jobs WHERE id=$1`, [jobId]);
            });
        }
        catch {
            // Best-effort — if DLQ insert fails, just leave the job as-is
            await this.pool.query(`UPDATE street_jobs SET status='failed', error=$1 WHERE id=$2`, [err.message, jobId]).catch(() => undefined);
        }
    }
}
//# sourceMappingURL=queue.js.map