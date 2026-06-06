import 'reflect-metadata';
export declare const STREET_JOBS_MIGRATION_SQL = "\nCREATE TABLE IF NOT EXISTS street_jobs (\n  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  type         TEXT NOT NULL,\n  payload      JSONB NOT NULL DEFAULT '{}',\n  status       TEXT NOT NULL DEFAULT 'pending',\n  attempt_count INT NOT NULL DEFAULT 0,\n  run_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  worker_id    TEXT,\n  locked_at    TIMESTAMPTZ,\n  error        TEXT\n);\nCREATE INDEX IF NOT EXISTS street_jobs_status_run_at ON street_jobs (status, run_at);\n";
export declare const STREET_DLQ_MIGRATION_SQL = "\nCREATE TABLE IF NOT EXISTS street_dead_letter_queue (\n  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  job_id       TEXT,\n  type         TEXT NOT NULL,\n  payload      JSONB NOT NULL DEFAULT '{}',\n  error        TEXT,\n  exhausted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),\n  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\n";
export declare const STREET_JOB_HISTORY_MIGRATION_SQL = "\nCREATE TABLE IF NOT EXISTS street_job_history (\n  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  job_id       TEXT,\n  type         TEXT NOT NULL,\n  status       TEXT NOT NULL,\n  duration_ms  INT,\n  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()\n);\nCREATE INDEX IF NOT EXISTS street_job_history_type_created_at ON street_job_history (type, created_at);\n";
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
type QueryResult = {
    rows: Record<string, string | null>[];
    rowCount: number;
    command: string;
};
export interface JobQueuePool {
    query(sql: string, params?: unknown[]): Promise<QueryResult>;
    transaction<T>(fn: (conn: {
        query(sql: string, params?: unknown[]): Promise<QueryResult>;
    }) => Promise<T>): Promise<T>;
}
export interface JobQueueOptions {
    concurrency?: number;
    pollIntervalMs?: number;
    workerId?: string;
}
/**
 * Structural view of the cron scheduler used for DLQ pruning. Kept as a minimal
 * interface (rather than a hard import of `CronScheduler`) so the queue stays
 * loosely coupled and free of import cycles, mirroring the `JobQueuePool` shape.
 */
export interface DlqPruneScheduler {
    register(expression: string, name: string, fn: () => Promise<void>): void;
}
/**
 * Class decorator that marks a class as a job handler for the given type.
 * The class must implement `execute(payload, ctx): Promise<void>`.
 */
export declare function Job(type: string): ClassDecorator;
export declare class JobQueue {
    private readonly pool;
    private readonly concurrency;
    private readonly pollIntervalMs;
    private readonly workerId;
    private readonly handlers;
    private readonly retryPolicies;
    private timer;
    constructor(pool: JobQueuePool, opts?: JobQueueOptions);
    /** Enqueue a new job, returning the generated job id. */
    enqueue(opts: JobEnqueueOpts): Promise<string>;
    /** Register a handler function for the given job type. */
    register(type: string, handler: JobHandler): void;
    /**
     * Register a class as a job handler.
     * The class must be decorated with @Job('type') and implement execute().
     */
    registerClass(ctor: new () => {
        execute(payload: unknown, ctx: JobContext): Promise<void>;
    }): void;
    /** Set a retry policy for a specific job type. */
    setRetryPolicy(type: string, policy: RetryPolicy): void;
    /**
     * Prune the dead letter queue down to at most `maxEntries` rows, keeping the
     * most recent entries (by `created_at`). Returns the number of rows deleted.
     *
     * Bounded by construction: the inner SELECT retains exactly the newest
     * `maxEntries` ids, and the DELETE removes everything else in a single
     * statement, so the table never exceeds `maxEntries` rows after a prune.
     */
    pruneDeadLetterQueue(maxEntries: number): Promise<number>;
    /**
     * Register a nightly cron job on the given scheduler that prunes the dead
     * letter queue to at most `maxEntries` rows. Defaults to midnight every day
     * ('0 0 * * *'). The scheduler must be started separately via `scheduler.start()`.
     */
    registerDlqPruning(scheduler: DlqPruneScheduler, maxEntries: number, cronExpression?: string): void;
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
    pruneJobHistory(maxPerType: number): Promise<number>;
    /**
     * Register a nightly cron job on the given scheduler that prunes the job
     * history to at most `maxPerType` rows per job type. Defaults to keeping the
     * last 1,000 rows per type and running at midnight every day ('0 0 * * *').
     * The scheduler must be started separately via `scheduler.start()`.
     */
    registerJobHistoryPruning(scheduler: DlqPruneScheduler, maxPerType?: number, cronExpression?: string): void;
    /** Start the polling loop. */
    start(): void;
    /** Stop the polling loop. */
    stop(): void;
    private _poll;
    private _dispatch;
    private _handleFailure;
    private _moveToDlq;
}
export {};
//# sourceMappingURL=queue.d.ts.map