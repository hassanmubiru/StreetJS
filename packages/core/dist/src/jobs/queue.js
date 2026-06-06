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
export const STREET_JOB_HISTORY_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_job_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       TEXT,
  type         TEXT NOT NULL,
  status       TEXT NOT NULL,
  duration_ms  INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_job_history_type_created_at ON street_job_history (type, created_at);
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
    heartbeatIntervalMs;
    reaperIntervalMs;
    staleJobThresholdMs;
    handlers = new Map();
    retryPolicies = new Map();
    /** Ids of jobs this worker is currently executing; targeted by the heartbeat. */
    inFlight = new Set();
    timer = null;
    heartbeatTimer = null;
    reaperTimer = null;
    constructor(pool, opts) {
        this.pool = pool;
        this.concurrency = opts?.concurrency ?? 5;
        this.pollIntervalMs = opts?.pollIntervalMs ?? 1_000;
        this.workerId = opts?.workerId ?? `worker-${process.pid}`;
        this.heartbeatIntervalMs = opts?.heartbeatIntervalMs ?? 30_000;
        this.reaperIntervalMs = opts?.reaperIntervalMs ?? 60_000;
        this.staleJobThresholdMs = opts?.staleJobThresholdMs ?? 120_000;
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
    /**
     * Prune the dead letter queue down to at most `maxEntries` rows, keeping the
     * most recent entries (by `created_at`). Returns the number of rows deleted.
     *
     * Bounded by construction: the inner SELECT retains exactly the newest
     * `maxEntries` ids, and the DELETE removes everything else in a single
     * statement, so the table never exceeds `maxEntries` rows after a prune.
     */
    async pruneDeadLetterQueue(maxEntries) {
        if (!Number.isInteger(maxEntries) || maxEntries < 0) {
            throw new Error(`pruneDeadLetterQueue: maxEntries must be a non-negative integer, got ${maxEntries}`);
        }
        const result = await this.pool.query(`DELETE FROM street_dead_letter_queue
       WHERE id NOT IN (
         SELECT id FROM street_dead_letter_queue
         ORDER BY created_at DESC
         LIMIT $1
       )`, [maxEntries]);
        return result.rowCount;
    }
    /**
     * Register a nightly cron job on the given scheduler that prunes the dead
     * letter queue to at most `maxEntries` rows. Defaults to midnight every day
     * ('0 0 * * *'). The scheduler must be started separately via `scheduler.start()`.
     */
    registerDlqPruning(scheduler, maxEntries, cronExpression = '0 0 * * *') {
        if (!Number.isInteger(maxEntries) || maxEntries < 0) {
            throw new Error(`registerDlqPruning: maxEntries must be a non-negative integer, got ${maxEntries}`);
        }
        scheduler.register(cronExpression, 'street:dlq-prune', async () => {
            await this.pruneDeadLetterQueue(maxEntries);
        });
    }
    /**
     * Prune the job history table down to at most `maxPerType` rows per job type,
     * keeping the most recent rows (by `created_at`) for each type. Returns the
     * number of rows deleted.
     *
     * Uses a window function (ROW_NUMBER() OVER (PARTITION BY type ORDER BY
     * created_at DESC)) to rank rows within each type, then deletes everything
     * ranked beyond `maxPerType`. This bounds each type independently in a single
     * statement so no type ever exceeds `maxPerType` rows after a prune.
     */
    async pruneJobHistory(maxPerType) {
        if (!Number.isInteger(maxPerType) || maxPerType < 0) {
            throw new Error(`pruneJobHistory: maxPerType must be a non-negative integer, got ${maxPerType}`);
        }
        const result = await this.pool.query(`DELETE FROM street_job_history
       WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY type ORDER BY created_at DESC) AS rn
           FROM street_job_history
         ) ranked
         WHERE ranked.rn > $1
       )`, [maxPerType]);
        return result.rowCount;
    }
    /**
     * Register a nightly cron job on the given scheduler that prunes the job
     * history to at most `maxPerType` rows per job type. Defaults to keeping the
     * last 1,000 rows per type and running at midnight every day ('0 0 * * *').
     * The scheduler must be started separately via `scheduler.start()`.
     */
    registerJobHistoryPruning(scheduler, maxPerType = 1_000, cronExpression = '0 0 * * *') {
        if (!Number.isInteger(maxPerType) || maxPerType < 0) {
            throw new Error(`registerJobHistoryPruning: maxPerType must be a non-negative integer, got ${maxPerType}`);
        }
        scheduler.register(cronExpression, 'street:job-history-prune', async () => {
            await this.pruneJobHistory(maxPerType);
        });
    }
    /**
     * Aggregate a point-in-time snapshot of queue health via SQL.
     *
     * Runs three aggregations:
     *  1. Live queue depth from `street_jobs`: `pending` (status='pending') and
     *     `inFlight` (status='running'), counted in a single scan via
     *     `COUNT(*) FILTER (WHERE ...)`.
     *  2. Terminal outcome counts from `street_job_history`: `succeeded`
     *     (status='succeeded') and `failed` (status='failed').
     *  3. Per-type average execution time from `street_job_history`, grouped by
     *     `type` over rows with a recorded `duration_ms`.
     *
     * Returns the shape `{ pending, inFlight, failed, succeeded, byType: { [type]: { avgDurationMs } } }`.
     */
    async metrics() {
        const liveResult = await this.pool.query(`SELECT
         COUNT(*) FILTER (WHERE status = 'pending') AS pending,
         COUNT(*) FILTER (WHERE status = 'running') AS in_flight
       FROM street_jobs`);
        const historyResult = await this.pool.query(`SELECT
         COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed
       FROM street_job_history`);
        const byTypeResult = await this.pool.query(`SELECT type, AVG(duration_ms) AS avg_duration_ms
       FROM street_job_history
       WHERE duration_ms IS NOT NULL
       GROUP BY type`);
        const liveRow = liveResult.rows[0] ?? {};
        const historyRow = historyResult.rows[0] ?? {};
        const byType = {};
        for (const row of byTypeResult.rows) {
            const type = row['type'];
            if (type === null || type === undefined)
                continue;
            byType[type] = { avgDurationMs: Math.round(_toNumber(row['avg_duration_ms'])) };
        }
        return {
            pending: _toNumber(liveRow['pending']),
            inFlight: _toNumber(liveRow['in_flight']),
            failed: _toNumber(historyRow['failed']),
            succeeded: _toNumber(historyRow['succeeded']),
            byType,
        };
    }
    /** Start the polling loop, the worker heartbeat, and the stale-job reaper. */
    start() {
        if (this.timer !== null)
            return;
        this.timer = setInterval(() => {
            void this._poll();
        }, this.pollIntervalMs);
        // Allow Node.js to exit even if the interval is still active
        this.timer.unref();
        // Heartbeat: refresh locked_at on this worker's in-flight jobs so other
        // workers' reapers don't reclaim jobs that are still being processed.
        this.heartbeatTimer = setInterval(() => {
            void this._heartbeat();
        }, this.heartbeatIntervalMs);
        this.heartbeatTimer.unref();
        // Reaper: re-enqueue jobs whose owning worker has gone silent (crashed
        // worker recovery).
        this.reaperTimer = setInterval(() => {
            void this._reapStaleJobs();
        }, this.reaperIntervalMs);
        this.reaperTimer.unref();
    }
    /** Stop the polling loop, heartbeat, and reaper. */
    stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.reaperTimer !== null) {
            clearInterval(this.reaperTimer);
            this.reaperTimer = null;
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
        // Track as in-flight so the heartbeat refreshes its lock while it runs.
        this.inFlight.add(jobId);
        try {
            await this._execute(jobId, type, row, attempt);
        }
        finally {
            this.inFlight.delete(jobId);
        }
    }
    async _execute(jobId, type, row, attempt) {
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
    /**
     * Refresh `locked_at` to NOW() for every job this worker is currently
     * executing. This keeps the lock fresh so other workers' reapers don't
     * reclaim a job that is still being processed. Targets only the tracked
     * in-flight ids and re-checks ownership (`worker_id`) and state in SQL.
     */
    async _heartbeat() {
        if (this.inFlight.size === 0)
            return;
        const ids = [...this.inFlight];
        try {
            await this.pool.query(`UPDATE street_jobs
         SET locked_at = NOW()
         WHERE status = 'running' AND worker_id = $1 AND id = ANY($2)`, [this.workerId, ids]);
        }
        catch {
            // DB unavailable — skip this beat; the job will simply be heartbeated next tick.
        }
    }
    /**
     * Re-enqueue jobs whose `locked_at` is older than the configured stale
     * threshold (default 2 minutes). A running job that hasn't been heartbeated
     * within the threshold is assumed to belong to a crashed/hung worker, so it
     * is reset to `pending` with its lock cleared for another worker to pick up.
     * Returns the number of jobs re-enqueued.
     */
    async _reapStaleJobs() {
        try {
            const result = await this.pool.query(`UPDATE street_jobs
         SET status='pending', worker_id=NULL, locked_at=NULL
         WHERE status='running' AND locked_at < NOW() - ($1 || ' milliseconds')::interval`, [String(this.staleJobThresholdMs)]);
            return result.rowCount;
        }
        catch {
            // DB unavailable — skip this scan
            return 0;
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
// ── Metrics route helper ───────────────────────────────────────────────────────
/**
 * Coerce a SQL aggregate value (PostgreSQL returns COUNT/AVG as strings, and
 * NULL for empty groups) into a finite number, defaulting to 0.
 */
function _toNumber(value) {
    if (value === null || value === undefined)
        return 0;
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}
/**
 * Register `GET /api/jobs/metrics` on a StreetApp instance, mirroring the
 * `registerHealthRoutes(app, registry)` / `registerMetricsRoute(app, registry)`
 * pattern. Responds 200 with the JSON snapshot produced by `queue.metrics()`:
 *
 *   { "pending": 0, "inFlight": 0, "failed": 0, "succeeded": 0,
 *     "byType": { "send-email": { "avgDurationMs": 123 } } }
 */
export function registerJobMetricsRoute(app, queue) {
    app.use(async (ctx, next) => {
        if (ctx.method === 'GET' && ctx.path === '/api/jobs/metrics') {
            const metrics = await queue.metrics();
            ctx.json(metrics, 200);
            return;
        }
        await next();
    });
}
//# sourceMappingURL=queue.js.map