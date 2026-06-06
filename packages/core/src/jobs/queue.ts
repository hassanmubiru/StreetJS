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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JobContext {
  jobId: string;
  attempt: number;
}

export type JobHandler = (payload: unknown, ctx: JobContext) => Promise<void>;

export interface JobEnqueueOpts {
  type: string;
  payload?: unknown;
  runAt?: Date;
}

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

type QueryResult = { rows: Record<string, string | null>[]; rowCount: number; command: string };

export interface JobQueuePool {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  transaction<T>(
    fn: (conn: { query(sql: string, params?: unknown[]): Promise<QueryResult> }) => Promise<T>,
  ): Promise<T>;
}

export interface JobQueueOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  workerId?: string;
  /** How often this worker refreshes `locked_at` on its in-flight jobs. Default: 30s. */
  heartbeatIntervalMs?: number;
  /** How often the background reaper scans for stale jobs. Default: 60s. */
  reaperIntervalMs?: number;
  /** A running job whose `locked_at` is older than this is considered stale and re-enqueued. Default: 2 minutes. */
  staleJobThresholdMs?: number;
}

/**
 * Structural view of the cron scheduler used for DLQ pruning. Kept as a minimal
 * interface (rather than a hard import of `CronScheduler`) so the queue stays
 * loosely coupled and free of import cycles, mirroring the `JobQueuePool` shape.
 */
export interface DlqPruneScheduler {
  register(expression: string, name: string, fn: () => Promise<void>): void;
}

// ── @Job decorator ────────────────────────────────────────────────────────────

const JOB_TYPE_META = 'street:jobType';

/**
 * Class decorator that marks a class as a job handler for the given type.
 * The class must implement `execute(payload, ctx): Promise<void>`.
 */
export function Job(type: string): ClassDecorator {
  return (target: object) => {
    Reflect.defineMetadata(JOB_TYPE_META, type, target);
  };
}

// ── JobQueue ──────────────────────────────────────────────────────────────────

export class JobQueue {
  private readonly pool: JobQueuePool;
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly workerId: string;
  private readonly heartbeatIntervalMs: number;
  private readonly reaperIntervalMs: number;
  private readonly staleJobThresholdMs: number;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly retryPolicies = new Map<string, RetryPolicy>();
  /** Ids of jobs this worker is currently executing; targeted by the heartbeat. */
  private readonly inFlight = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reaperTimer: ReturnType<typeof setInterval> | null = null;

  constructor(pool: JobQueuePool, opts?: JobQueueOptions) {
    this.pool = pool;
    this.concurrency = opts?.concurrency ?? 5;
    this.pollIntervalMs = opts?.pollIntervalMs ?? 1_000;
    this.workerId = opts?.workerId ?? `worker-${process.pid}`;
    this.heartbeatIntervalMs = opts?.heartbeatIntervalMs ?? 30_000;
    this.reaperIntervalMs = opts?.reaperIntervalMs ?? 60_000;
    this.staleJobThresholdMs = opts?.staleJobThresholdMs ?? 120_000;
  }

  /** Enqueue a new job, returning the generated job id. */
  async enqueue(opts: JobEnqueueOpts): Promise<string> {
    const { type, payload = {}, runAt } = opts;
    const result = await this.pool.query(
      `INSERT INTO street_jobs (type, payload, run_at)
       VALUES ($1, $2::jsonb, $3)
       RETURNING id`,
      [type, JSON.stringify(payload), runAt ?? new Date()],
    );
    return result.rows[0]['id'] as string;
  }

  /** Register a handler function for the given job type. */
  register(type: string, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Register a class as a job handler.
   * The class must be decorated with @Job('type') and implement execute().
   */
  registerClass(
    ctor: new () => { execute(payload: unknown, ctx: JobContext): Promise<void> },
  ): void {
    const type = Reflect.getMetadata(JOB_TYPE_META, ctor) as string | undefined;
    if (!type) {
      throw new Error(
        `Cannot registerClass: class ${ctor.name} is not decorated with @Job(type)`,
      );
    }
    const instance = new ctor();
    this.handlers.set(type, (payload, ctx) => instance.execute(payload, ctx));
  }

  /** Set a retry policy for a specific job type. */
  setRetryPolicy(type: string, policy: RetryPolicy): void {
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
  async pruneDeadLetterQueue(maxEntries: number): Promise<number> {
    if (!Number.isInteger(maxEntries) || maxEntries < 0) {
      throw new Error(`pruneDeadLetterQueue: maxEntries must be a non-negative integer, got ${maxEntries}`);
    }
    const result = await this.pool.query(
      `DELETE FROM street_dead_letter_queue
       WHERE id NOT IN (
         SELECT id FROM street_dead_letter_queue
         ORDER BY created_at DESC
         LIMIT $1
       )`,
      [maxEntries],
    );
    return result.rowCount;
  }

  /**
   * Register a nightly cron job on the given scheduler that prunes the dead
   * letter queue to at most `maxEntries` rows. Defaults to midnight every day
   * ('0 0 * * *'). The scheduler must be started separately via `scheduler.start()`.
   */
  registerDlqPruning(
    scheduler: DlqPruneScheduler,
    maxEntries: number,
    cronExpression = '0 0 * * *',
  ): void {
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
  async pruneJobHistory(maxPerType: number): Promise<number> {
    if (!Number.isInteger(maxPerType) || maxPerType < 0) {
      throw new Error(`pruneJobHistory: maxPerType must be a non-negative integer, got ${maxPerType}`);
    }
    const result = await this.pool.query(
      `DELETE FROM street_job_history
       WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY type ORDER BY created_at DESC) AS rn
           FROM street_job_history
         ) ranked
         WHERE ranked.rn > $1
       )`,
      [maxPerType],
    );
    return result.rowCount;
  }

  /**
   * Register a nightly cron job on the given scheduler that prunes the job
   * history to at most `maxPerType` rows per job type. Defaults to keeping the
   * last 1,000 rows per type and running at midnight every day ('0 0 * * *').
   * The scheduler must be started separately via `scheduler.start()`.
   */
  registerJobHistoryPruning(
    scheduler: DlqPruneScheduler,
    maxPerType = 1_000,
    cronExpression = '0 0 * * *',
  ): void {
    if (!Number.isInteger(maxPerType) || maxPerType < 0) {
      throw new Error(`registerJobHistoryPruning: maxPerType must be a non-negative integer, got ${maxPerType}`);
    }
    scheduler.register(cronExpression, 'street:job-history-prune', async () => {
      await this.pruneJobHistory(maxPerType);
    });
  }

  /** Start the polling loop, the worker heartbeat, and the stale-job reaper. */
  start(): void {
    if (this.timer !== null) return;
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
  stop(): void {
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

  private async _poll(): Promise<void> {
    let rows: Record<string, string | null>[];
    try {
      const result = await this.pool.query(
        `SELECT id, type, payload, attempt_count
         FROM street_jobs
         WHERE status = 'pending' AND run_at <= NOW()
         ORDER BY run_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT $1`,
        [this.concurrency],
      );
      rows = result.rows;
    } catch {
      // DB unavailable — skip this tick
      return;
    }

    await Promise.all(rows.map((row) => this._dispatch(row)));
  }

  private async _dispatch(row: Record<string, string | null>): Promise<void> {
    const jobId = row['id'] as string;
    const type = row['type'] as string;
    const attempt = parseInt(row['attempt_count'] as string, 10);

    // Lock the job
    try {
      await this.pool.query(
        `UPDATE street_jobs SET status='running', worker_id=$1, locked_at=NOW() WHERE id=$2`,
        [this.workerId, jobId],
      );
    } catch {
      return;
    }

    const handler = this.handlers.get(type);
    if (!handler) {
      // No handler registered — move straight to DLQ behaviour (treat as permanent failure)
      await this._handleFailure(jobId, type, row, attempt, new Error(`No handler registered for job type "${type}"`));
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(row['payload'] as string);
    } catch {
      payload = {};
    }

    try {
      await handler(payload, { jobId, attempt });
      // Success — delete the job
      await this.pool.query(`DELETE FROM street_jobs WHERE id=$1`, [jobId]);
    } catch (err) {
      await this._handleFailure(jobId, type, row, attempt, err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async _handleFailure(
    jobId: string,
    type: string,
    row: Record<string, string | null>,
    attempt: number,
    err: Error,
  ): Promise<void> {
    const policy = this.retryPolicies.get(type);
    const maxAttempts = policy?.maxAttempts ?? 1;
    const newAttemptCount = attempt + 1;

    if (newAttemptCount >= maxAttempts) {
      // Move to DLQ
      await this._moveToDlq(jobId, type, row, err);
    } else {
      // Compute backoff delay
      const delay = policy
        ? Math.min(
            policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt),
            policy.maxDelayMs,
          )
        : 0;

      await this.pool.query(
        `UPDATE street_jobs
         SET status='pending', attempt_count=$1, error=$2,
             run_at=NOW() + ($3 || ' milliseconds')::interval, worker_id=NULL, locked_at=NULL
         WHERE id=$4`,
        [newAttemptCount, err.message, String(delay), jobId],
      );
    }
  }

  private async _moveToDlq(
    jobId: string,
    type: string,
    row: Record<string, string | null>,
    err: Error,
  ): Promise<void> {
    try {
      await this.pool.transaction(async (conn) => {
        await conn.query(
          `INSERT INTO street_dead_letter_queue (job_id, type, payload, error)
           VALUES ($1, $2, $3::jsonb, $4)`,
          [jobId, type, row['payload'] ?? '{}', err.message],
        );
        await conn.query(`DELETE FROM street_jobs WHERE id=$1`, [jobId]);
      });
    } catch {
      // Best-effort — if DLQ insert fails, just leave the job as-is
      await this.pool.query(
        `UPDATE street_jobs SET status='failed', error=$1 WHERE id=$2`,
        [err.message, jobId],
      ).catch(() => undefined);
    }
  }
}
