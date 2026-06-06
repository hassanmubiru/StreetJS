// src/tests/job-queue.test.ts
// Unit tests for JobQueue and CronScheduler.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import {
  JobQueue,
  Job,
  registerJobMetricsRoute,
  STREET_JOBS_MIGRATION_SQL,
  STREET_DLQ_MIGRATION_SQL,
  STREET_JOB_HISTORY_MIGRATION_SQL,
  type JobQueuePool,
  type JobContext,
  type JobQueueMetrics,
} from '../jobs/queue.js';
import { CronScheduler, CronParseError } from '../jobs/scheduler.js';
import {
  STREET_WORKFLOWS_MIGRATION_SQL,
  WorkflowEngine,
  WorkflowStepTimeoutError,
  type WorkflowStep,
} from '../jobs/workflow.js';

// ── Tests: Migration SQL ──────────────────────────────────────────────────────

describe('JobQueue — Migration SQL', () => {
  it('STREET_JOBS_MIGRATION_SQL creates the street_jobs table with all required columns', () => {
    assert.ok(STREET_JOBS_MIGRATION_SQL.includes('street_jobs'), 'Should reference street_jobs table');
    assert.match(STREET_JOBS_MIGRATION_SQL, /id\s+UUID/i, 'id UUID');
    assert.match(STREET_JOBS_MIGRATION_SQL, /type\s+TEXT/i, 'type TEXT');
    assert.match(STREET_JOBS_MIGRATION_SQL, /payload\s+JSONB/i, 'payload JSONB');
    assert.match(STREET_JOBS_MIGRATION_SQL, /status\s+TEXT/i, 'status TEXT');
    assert.match(STREET_JOBS_MIGRATION_SQL, /attempt_count\s+INT/i, 'attempt_count INT');
    assert.match(STREET_JOBS_MIGRATION_SQL, /run_at\s+TIMESTAMPTZ/i, 'run_at TIMESTAMPTZ');
    assert.match(STREET_JOBS_MIGRATION_SQL, /created_at\s+TIMESTAMPTZ/i, 'created_at TIMESTAMPTZ');
    assert.match(STREET_JOBS_MIGRATION_SQL, /worker_id\s+TEXT/i, 'worker_id TEXT');
    assert.match(STREET_JOBS_MIGRATION_SQL, /locked_at\s+TIMESTAMPTZ/i, 'locked_at TIMESTAMPTZ');
    assert.match(STREET_JOBS_MIGRATION_SQL, /error\s+TEXT/i, 'error TEXT');
  });

  it('STREET_JOBS_MIGRATION_SQL adds a (status, run_at) index for polling efficiency', () => {
    assert.match(
      STREET_JOBS_MIGRATION_SQL,
      /CREATE INDEX[\s\S]*street_jobs\s*\(status,\s*run_at\)/i,
      'Should create an index on (status, run_at)',
    );
  });

  it('STREET_JOBS_MIGRATION_SQL is idempotent (uses IF NOT EXISTS)', () => {
    assert.match(STREET_JOBS_MIGRATION_SQL, /CREATE TABLE IF NOT EXISTS/i);
    assert.match(STREET_JOBS_MIGRATION_SQL, /CREATE INDEX IF NOT EXISTS/i);
  });

  it('STREET_DLQ_MIGRATION_SQL creates the street_dead_letter_queue table with all required columns', () => {
    assert.ok(
      STREET_DLQ_MIGRATION_SQL.includes('street_dead_letter_queue'),
      'Should reference street_dead_letter_queue table',
    );
    assert.match(STREET_DLQ_MIGRATION_SQL, /id\s+UUID/i, 'id UUID');
    assert.match(STREET_DLQ_MIGRATION_SQL, /job_id\s+TEXT/i, 'job_id TEXT');
    assert.match(STREET_DLQ_MIGRATION_SQL, /type\s+TEXT/i, 'type TEXT');
    assert.match(STREET_DLQ_MIGRATION_SQL, /payload\s+JSONB/i, 'payload JSONB');
    assert.match(STREET_DLQ_MIGRATION_SQL, /error\s+TEXT/i, 'error TEXT');
    assert.match(STREET_DLQ_MIGRATION_SQL, /exhausted_at\s+TIMESTAMPTZ/i, 'exhausted_at TIMESTAMPTZ');
    assert.match(STREET_DLQ_MIGRATION_SQL, /created_at\s+TIMESTAMPTZ/i, 'created_at TIMESTAMPTZ');
  });

  it('STREET_DLQ_MIGRATION_SQL is idempotent (uses IF NOT EXISTS)', () => {
    assert.match(STREET_DLQ_MIGRATION_SQL, /CREATE TABLE IF NOT EXISTS/i);
  });
});

// ── Tests: Job History Migration SQL ──────────────────────────────────────────

describe('JobQueue — Job History Migration SQL', () => {
  it('STREET_JOB_HISTORY_MIGRATION_SQL creates the street_job_history table with all required columns', () => {
    assert.ok(
      STREET_JOB_HISTORY_MIGRATION_SQL.includes('street_job_history'),
      'Should reference street_job_history table',
    );
    assert.match(STREET_JOB_HISTORY_MIGRATION_SQL, /id\s+UUID/i, 'id UUID');
    assert.match(STREET_JOB_HISTORY_MIGRATION_SQL, /job_id\s+TEXT/i, 'job_id TEXT');
    assert.match(STREET_JOB_HISTORY_MIGRATION_SQL, /type\s+TEXT/i, 'type TEXT');
    assert.match(STREET_JOB_HISTORY_MIGRATION_SQL, /status\s+TEXT/i, 'status TEXT');
    assert.match(STREET_JOB_HISTORY_MIGRATION_SQL, /duration_ms\s+INT/i, 'duration_ms INT');
    assert.match(STREET_JOB_HISTORY_MIGRATION_SQL, /created_at\s+TIMESTAMPTZ/i, 'created_at TIMESTAMPTZ');
  });

  it('STREET_JOB_HISTORY_MIGRATION_SQL declares id as the primary key', () => {
    assert.match(STREET_JOB_HISTORY_MIGRATION_SQL, /id\s+UUID\s+PRIMARY KEY/i, 'id UUID PRIMARY KEY');
  });

  it('STREET_JOB_HISTORY_MIGRATION_SQL adds a (type, created_at) index for per-type pruning', () => {
    assert.match(
      STREET_JOB_HISTORY_MIGRATION_SQL,
      /CREATE INDEX[\s\S]*street_job_history\s*\(type,\s*created_at\)/i,
      'Should create an index on (type, created_at)',
    );
  });

  it('STREET_JOB_HISTORY_MIGRATION_SQL is idempotent (uses IF NOT EXISTS)', () => {
    assert.match(STREET_JOB_HISTORY_MIGRATION_SQL, /CREATE TABLE IF NOT EXISTS/i);
    assert.match(STREET_JOB_HISTORY_MIGRATION_SQL, /CREATE INDEX IF NOT EXISTS/i);
  });
});

// ── Tests: WorkflowEngine Migration SQL ───────────────────────────────────────

describe('WorkflowEngine — Migration SQL', () => {
  it('STREET_WORKFLOWS_MIGRATION_SQL creates the street_workflows table with all required columns', () => {
    assert.ok(
      STREET_WORKFLOWS_MIGRATION_SQL.includes('street_workflows'),
      'Should reference street_workflows table',
    );
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /id\s+UUID/i, 'id UUID');
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /name\s+TEXT/i, 'name TEXT');
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /status\s+TEXT/i, 'status TEXT');
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /current_step\s+INT/i, 'current_step INT');
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /step_outputs\s+JSONB/i, 'step_outputs JSONB');
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /input\s+JSONB/i, 'input JSONB');
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /error\s+TEXT/i, 'error TEXT');
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /created_at\s+TIMESTAMPTZ/i, 'created_at TIMESTAMPTZ');
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /updated_at\s+TIMESTAMPTZ/i, 'updated_at TIMESTAMPTZ');
  });

  it('STREET_WORKFLOWS_MIGRATION_SQL declares id as the primary key', () => {
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /id\s+UUID\s+PRIMARY KEY/i, 'id UUID PRIMARY KEY');
  });

  it('STREET_WORKFLOWS_MIGRATION_SQL is idempotent (uses IF NOT EXISTS)', () => {
    assert.match(STREET_WORKFLOWS_MIGRATION_SQL, /CREATE TABLE IF NOT EXISTS/i);
  });
});

// ── Mock pool helpers ─────────────────────────────────────────────────────────

type QueryResult = { rows: Record<string, string | null>[]; rowCount: number; command: string };

/** Build a simple mock pool that records calls and returns configured responses. */
function makeMockPool(opts: {
  enqueueId?: string;
  jobRows?: Record<string, string>[];
} = {}): JobQueuePool & { queries: Array<{ sql: string; params?: unknown[] }> } {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  return {
    queries,
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      queries.push({ sql, params });

      if (sql.includes('INSERT INTO street_jobs') && sql.includes('RETURNING id')) {
        return { rows: [{ id: opts.enqueueId ?? 'test-uuid-1' }], rowCount: 1, command: 'INSERT' };
      }
      if (sql.includes('SELECT') && sql.includes('FOR UPDATE SKIP LOCKED')) {
        return {
          rows: (opts.jobRows ?? []) as Record<string, string | null>[],
          rowCount: opts.jobRows?.length ?? 0,
          command: 'SELECT',
        };
      }
      if (sql.includes('DELETE FROM street_jobs') || sql.includes('UPDATE street_jobs')) {
        return { rows: [], rowCount: 1, command: 'UPDATE' };
      }
      return { rows: [], rowCount: 0, command: 'SELECT' };
    },
    async transaction<T>(fn: (conn: { query(sql: string, params?: unknown[]): Promise<QueryResult> }) => Promise<T>): Promise<T> {
      return fn({ query: async (sql, params) => this.query(sql, params) });
    },
  };
}

// ── Tests: JobQueue.enqueue ───────────────────────────────────────────────────

describe('JobQueue.enqueue', () => {
  it('inserts a row and returns the job id', async () => {
    const pool = makeMockPool({ enqueueId: 'abc-123' });
    const queue = new JobQueue(pool);
    const id = await queue.enqueue({ type: 'send-email', payload: { to: 'a@b.com' } });
    assert.equal(id, 'abc-123');

    const insertQuery = pool.queries.find((q) => q.sql.includes('INSERT INTO street_jobs'));
    assert.ok(insertQuery, 'Expected INSERT query to be recorded');
    const params = insertQuery!.params as unknown[];
    assert.equal(params[0], 'send-email');
    assert.ok(params[1] !== undefined);
  });

  it('stores run_at from options in INSERT params', async () => {
    const pool = makeMockPool({ enqueueId: 'delayed-1' });
    const queue = new JobQueue(pool);
    const futureDate = new Date(Date.now() + 60_000);
    await queue.enqueue({ type: 'delayed-task', runAt: futureDate });

    const insertQuery = pool.queries.find((q) => q.sql.includes('INSERT INTO street_jobs'));
    assert.ok(insertQuery, 'Expected INSERT query');
    const params = insertQuery!.params as unknown[];
    // Third param is run_at
    assert.deepEqual(params[2], futureDate);
  });
});

// ── Tests: JobQueue execution (polling) ───────────────────────────────────────

describe('JobQueue handler execution', () => {
  it('dispatches a job to the registered handler', async () => {
    const executedPayloads: unknown[] = [];
    const jobRow: Record<string, string> = {
      id: 'job-1',
      type: 'test-job',
      payload: '{"key":"value"}',
      attempt_count: '0',
    };
    const pool = makeMockPool({ jobRows: [jobRow] });
    const queue = new JobQueue(pool, { pollIntervalMs: 50 });
    queue.register('test-job', async (payload) => {
      executedPayloads.push(payload);
    });

    queue.start();
    // Wait for one poll cycle
    await new Promise((res) => setTimeout(res, 100));
    queue.stop();

    assert.ok(executedPayloads.length >= 1, 'Handler should have been called at least once');
    assert.deepEqual(executedPayloads[0], { key: 'value' });
  });

  it('DELETE is called after successful execution', async () => {
    const jobRow: Record<string, string> = {
      id: 'job-del',
      type: 'del-job',
      payload: '{}',
      attempt_count: '0',
    };
    const pool = makeMockPool({ jobRows: [jobRow] });
    const queue = new JobQueue(pool, { pollIntervalMs: 50 });
    queue.register('del-job', async () => { /* noop */ });

    queue.start();
    await new Promise((res) => setTimeout(res, 100));
    queue.stop();

    const deleteQuery = pool.queries.find(
      (q) => q.sql.includes('DELETE FROM street_jobs') && (q.params as unknown[])[0] === 'job-del',
    );
    assert.ok(deleteQuery, 'Expected DELETE query for completed job');
  });
});

// ── Tests: @Job decorator and registerClass ───────────────────────────────────

describe('@Job decorator and registerClass', () => {
  it('registers a class decorated with @Job', async () => {
    const executed: Array<{ payload: unknown; ctx: JobContext }> = [];

    @Job('decorated-job')
    class MyJob {
      async execute(payload: unknown, ctx: JobContext): Promise<void> {
        executed.push({ payload, ctx });
      }
    }

    const jobRow: Record<string, string> = {
      id: 'deco-1',
      type: 'decorated-job',
      payload: '{"msg":"hello"}',
      attempt_count: '0',
    };
    const pool = makeMockPool({ jobRows: [jobRow] });
    const queue = new JobQueue(pool, { pollIntervalMs: 50 });
    queue.registerClass(MyJob);

    queue.start();
    await new Promise((res) => setTimeout(res, 100));
    queue.stop();

    assert.ok(executed.length >= 1, 'Decorated class handler should have executed');
    assert.deepEqual(executed[0].payload, { msg: 'hello' });
    assert.equal(executed[0].ctx.jobId, 'deco-1');
  });

  it('throws when registering a class without @Job decorator', () => {
    class PlainClass {
      async execute(_payload: unknown, _ctx: JobContext): Promise<void> { /* noop */ }
    }
    const pool = makeMockPool();
    const queue = new JobQueue(pool);
    assert.throws(
      () => queue.registerClass(PlainClass as unknown as new () => { execute(payload: unknown, ctx: JobContext): Promise<void> }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok((err as Error).message.includes('not decorated with @Job'));
        return true;
      },
    );
  });
});

// ── Tests: Delayed job ────────────────────────────────────────────────────────

describe('Delayed job', () => {
  it('stores the correct runAt date in the INSERT params', async () => {
    const pool = makeMockPool({ enqueueId: 'delayed-job-1' });
    const queue = new JobQueue(pool);

    const runAt = new Date(Date.now() + 3_600_000); // 1 hour from now
    await queue.enqueue({ type: 'delayed', runAt });

    const insert = pool.queries.find((q) => q.sql.includes('INSERT INTO street_jobs'));
    assert.ok(insert);
    const params = insert!.params as unknown[];
    assert.deepEqual(params[2], runAt, 'run_at param should equal the provided date');
  });
});

// ── Stateful mock pool ────────────────────────────────────────────────────────

interface StoredJob {
  id: string;
  type: string;
  payload: string;
  status: string;
  attempt_count: number;
  run_at: Date;
  worker_id: string | null;
  locked_at: Date | null;
  error: string | null;
}

interface DlqRow {
  job_id: string;
  type: string;
  payload: unknown;
  error: string;
}

/** A recorded transaction: the ordered list of statements executed inside one `transaction()` call. */
type RecordedTransaction = Array<{ sql: string; params?: unknown[] }>;

/**
 * A stateful in-memory pool that honours the real polling contract:
 *  - INSERT stores a pending job with its run_at.
 *  - The polling SELECT only returns pending jobs whose run_at <= NOW().
 *  - UPDATE/DELETE mutate the in-memory store.
 *
 * This lets us drive a job through the genuine enqueue -> poll -> execute path
 * and assert run_at gating behaviour. NOW() is resolved via Date.now(), so the
 * test can drive time deterministically with mock timers.
 */
function makeStatefulPool(opts: { failDlqInsert?: boolean } = {}): JobQueuePool & {
  jobs: Map<string, StoredJob>;
  dlq: DlqRow[];
  transactions: RecordedTransaction[];
} {
  const jobs = new Map<string, StoredJob>();
  const dlq: DlqRow[] = [];
  const transactions: RecordedTransaction[] = [];
  let currentTxn: RecordedTransaction | null = null;
  let seq = 0;

  const pool: JobQueuePool & {
    jobs: Map<string, StoredJob>;
    dlq: DlqRow[];
    transactions: RecordedTransaction[];
  } = {
    jobs,
    dlq,
    transactions,
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      const args = (params ?? []) as unknown[];

      // Record the statement against the active transaction (if any) so tests can
      // assert that related writes occurred within a single transaction.
      if (currentTxn) currentTxn.push({ sql, params });

      if (sql.includes('INSERT INTO street_jobs') && sql.includes('RETURNING id')) {
        const id = `job-${++seq}`;
        const type = args[0] as string;
        const payload = args[1] as string;
        const runAt = args[2] as Date;
        jobs.set(id, {
          id,
          type,
          payload,
          status: 'pending',
          attempt_count: 0,
          run_at: runAt,
          worker_id: null,
          locked_at: null,
          error: null,
        });
        return { rows: [{ id }], rowCount: 1, command: 'INSERT' };
      }

      if (sql.includes('INSERT INTO street_dead_letter_queue')) {
        if (opts.failDlqInsert) {
          throw new Error('simulated DLQ insert failure');
        }
        dlq.push({
          job_id: args[0] as string,
          type: args[1] as string,
          payload: args[2],
          error: args[3] as string,
        });
        return { rows: [], rowCount: 1, command: 'INSERT' };
      }

      if (sql.includes('FOR UPDATE SKIP LOCKED')) {
        const now = Date.now();
        const limit = (args[0] as number) ?? 100;
        const ready = [...jobs.values()]
          .filter((j) => j.status === 'pending' && j.run_at.getTime() <= now)
          .sort((a, b) => a.run_at.getTime() - b.run_at.getTime())
          .slice(0, limit)
          .map((j) => ({
            id: j.id,
            type: j.type,
            payload: j.payload,
            attempt_count: String(j.attempt_count),
          }));
        return { rows: ready as Record<string, string | null>[], rowCount: ready.length, command: 'SELECT' };
      }

      if (sql.includes("UPDATE street_jobs SET status='running'")) {
        const id = args[1] as string;
        const job = jobs.get(id);
        if (job) {
          job.status = 'running';
          job.worker_id = args[0] as string;
          job.locked_at = new Date();
        }
        return { rows: [], rowCount: 1, command: 'UPDATE' };
      }

      if (sql.includes('DELETE FROM street_jobs')) {
        const id = args[0] as string;
        jobs.delete(id);
        return { rows: [], rowCount: 1, command: 'DELETE' };
      }

      if (sql.includes('UPDATE street_jobs') && sql.includes("status='pending'")) {
        // retry re-scheduling: mirror `run_at = NOW() + ($delay || ' milliseconds')::interval`
        const id = args[3] as string;
        const job = jobs.get(id);
        if (job) {
          job.status = 'pending';
          job.attempt_count = args[0] as number;
          job.error = args[1] as string;
          const delayMs = Number(args[2]);
          job.run_at = new Date(Date.now() + delayMs);
          job.worker_id = null;
          job.locked_at = null;
        }
        return { rows: [], rowCount: 1, command: 'UPDATE' };
      }

      if (sql.includes("UPDATE street_jobs SET status='failed'")) {
        const id = args[1] as string;
        const job = jobs.get(id);
        if (job) {
          job.status = 'failed';
          job.error = args[0] as string;
        }
        return { rows: [], rowCount: 1, command: 'UPDATE' };
      }

      return { rows: [], rowCount: 0, command: 'SELECT' };
    },
    async transaction<T>(
      fn: (conn: { query(sql: string, params?: unknown[]): Promise<QueryResult> }) => Promise<T>,
    ): Promise<T> {
      // Snapshot state so we can roll back atomically if the callback throws,
      // mirroring real BEGIN/COMMIT/ROLLBACK semantics.
      const jobsSnapshot = new Map(
        [...jobs.entries()].map(([k, v]) => [k, { ...v }] as const),
      );
      const dlqSnapshot = dlq.length;
      const stmts: RecordedTransaction = [];
      const previousTxn = currentTxn;
      currentTxn = stmts;
      try {
        const result = await fn({ query: (sql, params) => pool.query(sql, params) });
        transactions.push(stmts);
        return result;
      } catch (err) {
        // Roll back: restore the jobs map and trim any DLQ rows appended in this txn.
        jobs.clear();
        for (const [k, v] of jobsSnapshot) jobs.set(k, v);
        dlq.length = dlqSnapshot;
        throw err;
      } finally {
        currentTxn = previousTxn;
      }
    },
  };

  return pool;
}

/** Drain pending microtasks (the async poll/dispatch chain) after advancing timers. */
const flushAsync = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Advance mock timers in `stepMs` increments, draining the async work between
 * each tick so each poll completes (and deletes its job) before the next fires.
 * This mirrors real sequential polling and avoids artificial double-dispatch.
 */
async function advancePolls(timers: { tick(ms: number): void }, totalMs: number, stepMs: number): Promise<void> {
  for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
    timers.tick(stepMs);
    await flushAsync();
  }
}

// ── Tests: enqueue -> poll -> execute (integration through real polling loop) ──

describe('JobQueue polling loop — enqueue and execute', () => {
  it('executes an enqueued job on the next poll tick and removes it on success', async (t) => {
    const T0 = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });

    const pool = makeStatefulPool();
    const queue = new JobQueue(pool, { pollIntervalMs: 100, concurrency: 5 });

    const executed: Array<{ payload: unknown; ctx: JobContext }> = [];
    queue.register('greet', async (payload, ctx) => {
      executed.push({ payload, ctx });
    });

    const id = await queue.enqueue({ type: 'greet', payload: { name: 'Ada' } });
    assert.ok(pool.jobs.has(id), 'Job should be persisted as pending after enqueue');
    assert.equal(executed.length, 0, 'Job must not run before the polling loop ticks');

    queue.start();
    await advancePolls(t.mock.timers, 100, 100); // one poll cycle
    queue.stop();

    assert.equal(executed.length, 1, 'Polling loop should execute the enqueued job exactly once');
    assert.deepEqual(executed[0].payload, { name: 'Ada' });
    assert.equal(executed[0].ctx.jobId, id, 'Handler context should carry the job id');
    assert.equal(executed[0].ctx.attempt, 0, 'First execution is attempt 0');
    assert.ok(!pool.jobs.has(id), 'Successful job should be deleted from the queue');
  });
});

// ── Tests: delayed job is not executed before runAt ───────────────────────────

describe('Delayed job execution timing', () => {
  it('does not execute a delayed job before its runAt, then executes it once due', async (t) => {
    const T0 = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });

    const pool = makeStatefulPool();
    const queue = new JobQueue(pool, { pollIntervalMs: 100, concurrency: 5 });

    const ran: string[] = [];
    queue.register('immediate', async () => {
      ran.push('immediate');
    });
    queue.register('later', async () => {
      ran.push('later');
    });

    await queue.enqueue({ type: 'immediate' }); // run_at defaults to now (T0)
    const delayedId = await queue.enqueue({ type: 'later', runAt: new Date(T0 + 5_000) });

    queue.start();

    // One poll just after T0: the immediate job is due, the delayed one is not.
    await advancePolls(t.mock.timers, 100, 100); // now ~ T0 + 100
    assert.deepEqual(ran, ['immediate'], 'Only the immediate job should have run');
    assert.ok(pool.jobs.has(delayedId), 'Delayed job should still be queued');

    // Advance to just before runAt (T0 + 4100): still must not run.
    await advancePolls(t.mock.timers, 4_000, 100);
    assert.deepEqual(ran, ['immediate'], 'Delayed job must not run before its runAt');
    assert.ok(pool.jobs.has(delayedId), 'Delayed job should still be queued before runAt');

    // Advance past runAt (T0 + 5100): now it becomes due and runs exactly once.
    await advancePolls(t.mock.timers, 1_000, 100);
    queue.stop();

    assert.deepEqual(ran, ['immediate', 'later'], 'Delayed job should run once its runAt has passed');
    assert.ok(!pool.jobs.has(delayedId), 'Delayed job should be removed after successful execution');
  });
});

// ── Tests: cron fires on the correct tick ─────────────────────────────────────

describe('CronScheduler firing', () => {
  it('fires on the correct tick (at the next minute boundary, not before)', async (t) => {
    // Choose a start instant that is offset 20s into a minute so the boundary is
    // a non-trivial 40s away.
    const T0 = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });

    const sched = new CronScheduler();
    const fires: number[] = [];
    sched.register('* * * * *', 'every-minute', async () => {
      fires.push(Date.now());
    });

    sched.start();

    const now = Date.now();
    const delayToBoundary = 60_000 - (now % 60_000); // ms to the next whole minute
    assert.ok(delayToBoundary > 1, 'Sanity: boundary should be more than 1ms away');

    // Just before the boundary: must not have fired yet.
    t.mock.timers.tick(delayToBoundary - 1);
    await flushAsync();
    assert.equal(fires.length, 0, 'Cron must not fire before its scheduled tick');

    // Crossing the boundary: fires exactly once.
    t.mock.timers.tick(1);
    await flushAsync();
    assert.equal(fires.length, 1, 'Cron should fire on the correct tick');
    assert.equal(fires[0] % 60_000, 0, 'Fire instant should land on a whole-minute boundary');

    sched.stop();
  });
});

// ── Tests: CronParseError ─────────────────────────────────────────────────────

describe('CronScheduler.register — invalid expressions', () => {
  it('throws CronParseError for too few fields', () => {
    const sched = new CronScheduler();
    assert.throws(
      () => sched.register('* * * *', 'bad', async () => {}),
      (err: unknown) => {
        assert.ok(err instanceof CronParseError);
        assert.match(err.message, /expected 5 fields/);
        return true;
      },
    );
  });

  it('throws CronParseError for out-of-range minute', () => {
    const sched = new CronScheduler();
    assert.throws(
      () => sched.register('60 * * * *', 'bad-min', async () => {}),
      (err: unknown) => {
        assert.ok(err instanceof CronParseError);
        return true;
      },
    );
  });

  it('throws CronParseError for out-of-range hour', () => {
    const sched = new CronScheduler();
    assert.throws(
      () => sched.register('0 24 * * *', 'bad-hour', async () => {}),
      (err: unknown) => {
        assert.ok(err instanceof CronParseError);
        return true;
      },
    );
  });

  it('throws CronParseError for non-numeric value', () => {
    const sched = new CronScheduler();
    assert.throws(
      () => sched.register('abc * * * *', 'bad-val', async () => {}),
      (err: unknown) => {
        assert.ok(err instanceof CronParseError);
        return true;
      },
    );
  });

  it('accepts a valid expression without throwing', () => {
    const sched = new CronScheduler();
    assert.doesNotThrow(() => sched.register('0 0 * * *', 'daily', async () => {}));
    assert.doesNotThrow(() => sched.register('*/15 * * * *', 'every-15m', async () => {}));
    assert.doesNotThrow(() => sched.register('0 9-17 * * 1-5', 'weekday-hours', async () => {}));
  });
});

// ── Tests: Single-instance guard ──────────────────────────────────────────────

/**
 * Minimal structural view of CronScheduler internals so we can exercise the real
 * `_fire` guard against the real entry state (rather than simulating it).
 */
interface SchedulerInternals {
  started: boolean;
  jobs: Map<string, { running: boolean; timer: ReturnType<typeof setTimeout> | null }>;
  _fire(entry: unknown): Promise<void>;
}

describe('CronScheduler single-instance guard', () => {
  it('skips a second invocation while the same job is still running (real _fire guard)', async () => {
    const sched = new CronScheduler();

    let calls = 0;
    let active = 0;
    let maxConcurrent = 0;
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });

    sched.register('* * * * *', 'slow', async () => {
      calls++;
      active++;
      if (active > maxConcurrent) maxConcurrent = active;
      await gate; // hold the job "running" until we release it
      active--;
    });

    const internal = sched as unknown as SchedulerInternals;
    internal.started = true; // _fire returns early unless started
    const entry = internal.jobs.get('slow');
    assert.ok(entry, 'Expected the registered entry to exist');

    // First fire begins execution and suspends on the gate while running.
    const p1 = internal._fire(entry);
    assert.equal(calls, 1, 'First fire should invoke the job exactly once');
    assert.equal(entry!.running, true, 'Entry should be flagged as running');

    // Second fire while still running must be skipped by the guard.
    const p2 = internal._fire(entry);
    assert.equal(calls, 1, 'Guard must prevent a second concurrent invocation');
    assert.equal(maxConcurrent, 1, 'At most one instance may run at a time');

    // Release the first invocation and let both settle.
    release();
    await Promise.all([p1, p2]);

    assert.equal(calls, 1, 'No additional invocation should have occurred after completion');
    assert.equal(maxConcurrent, 1, 'Concurrency never exceeded one');
    assert.equal(entry!.running, false, 'Entry should no longer be running');

    sched.stop();
  });
});

// ── Tests: Retry policy backoff formula ──────────────────────────────────────

describe('RetryPolicy backoff formula', () => {
  it('computes delay as Math.min(initialDelay * multiplier^attempt, maxDelay)', () => {
    // Verify the formula directly
    const policy = { maxAttempts: 5, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 10_000 };

    const delays = [0, 1, 2, 3].map((attempt) =>
      Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt), policy.maxDelayMs),
    );

    assert.equal(delays[0], 1000);   // 1000 * 2^0 = 1000
    assert.equal(delays[1], 2000);   // 1000 * 2^1 = 2000
    assert.equal(delays[2], 4000);   // 1000 * 2^2 = 4000
    assert.equal(delays[3], 8000);   // 1000 * 2^3 = 8000
  });

  it('caps delay at maxDelayMs', () => {
    const policy = { maxAttempts: 10, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 5000 };
    const delay = Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, 10), policy.maxDelayMs);
    assert.equal(delay, 5000);
  });
});

// ── Tests: setRetryPolicy registration (per-job-type retry config) ────────────

describe('JobQueue.setRetryPolicy', () => {
  it('accepts a policy with all four fields without throwing', () => {
    const pool = makeMockPool();
    const queue = new JobQueue(pool);
    assert.doesNotThrow(() =>
      queue.setRetryPolicy('send-email', {
        maxAttempts: 5,
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        maxDelayMs: 30_000,
      }),
    );
  });

  it('reschedules a failing job (status=pending) when a per-type policy allows more attempts', async (t) => {
    const T0 = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });

    const pool = makeStatefulPool();
    const queue = new JobQueue(pool, { pollIntervalMs: 100, concurrency: 5 });

    // Register a per-type retry policy permitting multiple attempts.
    queue.setRetryPolicy('flaky', {
      maxAttempts: 3,
      initialDelayMs: 500,
      backoffMultiplier: 2,
      maxDelayMs: 10_000,
    });

    queue.register('flaky', async () => {
      throw new Error('boom');
    });

    const id = await queue.enqueue({ type: 'flaky' });

    queue.start();
    await advancePolls(t.mock.timers, 100, 100); // one poll cycle: job fails once
    queue.stop();

    const job = pool.jobs.get(id);
    assert.ok(job, 'Job with remaining attempts must be retained, not removed');
    assert.equal(job!.status, 'pending', 'Failing job should be re-scheduled as pending');
    assert.equal(job!.attempt_count, 1, 'attempt_count should be incremented after a failed attempt');
    assert.equal(job!.error, 'boom', 'Failure error should be recorded');
  });

  it('uses per-type policies independently — each type retains its own config', () => {
    const pool = makeMockPool();
    const queue = new JobQueue(pool);

    queue.setRetryPolicy('a', { maxAttempts: 2, initialDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 1000 });
    queue.setRetryPolicy('b', { maxAttempts: 7, initialDelayMs: 250, backoffMultiplier: 3, maxDelayMs: 9000 });

    // Inspect the internal per-type map to confirm isolation between types.
    const policies = (queue as unknown as { retryPolicies: Map<string, { maxAttempts: number }> }).retryPolicies;
    assert.equal(policies.get('a')!.maxAttempts, 2);
    assert.equal(policies.get('b')!.maxAttempts, 7);
  });
});

// ── Tests: geometric backoff applied in the polling loop ──────────────────────

describe('JobQueue polling loop — geometric backoff on failure', () => {
  it('reschedules run_at to NOW() + initialDelay*multiplier^attempt, increments attempt_count, and clears the lock', async (t) => {
    const T0 = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });

    const pool = makeStatefulPool();
    const queue = new JobQueue(pool, { pollIntervalMs: 100, concurrency: 5 });

    const policy = { maxAttempts: 5, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 10_000 };
    queue.setRetryPolicy('flaky', policy);
    queue.register('flaky', async () => {
      throw new Error('boom');
    });

    const id = await queue.enqueue({ type: 'flaky' });

    // First failure: attempt 0 -> delay = 1000 * 2^0 = 1000ms.
    queue.start();
    await advancePolls(t.mock.timers, 100, 100);

    const after1 = pool.jobs.get(id);
    assert.ok(after1, 'Job with remaining attempts must be retained');
    assert.equal(after1!.attempt_count, 1, 'attempt_count should increment to 1');
    assert.equal(after1!.status, 'pending', 'Job should be rescheduled as pending');
    assert.equal(after1!.worker_id, null, 'worker_id must be cleared on reschedule');
    assert.equal(after1!.locked_at, null, 'locked_at must be cleared on reschedule');
    const expectedDelay1 = Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, 0), policy.maxDelayMs);
    assert.equal(
      after1!.run_at.getTime(),
      Date.now() + expectedDelay1,
      'run_at should be NOW() + 1000ms after the first failure',
    );

    // Advance to when the retry becomes due (1000ms later) for the second failure.
    // attempt 1 -> delay = 1000 * 2^1 = 2000ms.
    await advancePolls(t.mock.timers, 1_000, 100);

    const after2 = pool.jobs.get(id);
    assert.ok(after2, 'Job should still be retained after the second failure');
    assert.equal(after2!.attempt_count, 2, 'attempt_count should increment to 2');
    const expectedDelay2 = Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, 1), policy.maxDelayMs);
    assert.equal(
      after2!.run_at.getTime(),
      Date.now() + expectedDelay2,
      'run_at should be NOW() + 2000ms after the second failure',
    );

    // Advance to when the second retry becomes due (2000ms later) for the third failure.
    // attempt 2 -> delay = 1000 * 2^2 = 4000ms, proving the exponent grows with the attempt.
    await advancePolls(t.mock.timers, 2_000, 100);

    const after3 = pool.jobs.get(id);
    assert.ok(after3, 'Job should still be retained after the third failure');
    assert.equal(after3!.attempt_count, 3, 'attempt_count should increment to 3');
    const expectedDelay3 = Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, 2), policy.maxDelayMs);
    assert.equal(expectedDelay3, 4000, 'Sanity: third backoff is 1000 * 2^2 = 4000ms (uncapped)');
    assert.equal(
      after3!.run_at.getTime(),
      Date.now() + expectedDelay3,
      'run_at should be NOW() + 4000ms after the third failure (geometric growth)',
    );

    queue.stop();
  });

  it('caps the rescheduled backoff delay at maxDelayMs', async (t) => {
    const T0 = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });

    const pool = makeStatefulPool();
    const queue = new JobQueue(pool, { pollIntervalMs: 100, concurrency: 5 });

    // initialDelay*multiplier^0 = 5000 already exceeds maxDelayMs=1000, so the
    // very first retry must be capped.
    const policy = { maxAttempts: 5, initialDelayMs: 5000, backoffMultiplier: 2, maxDelayMs: 1000 };
    queue.setRetryPolicy('capped', policy);
    queue.register('capped', async () => {
      throw new Error('nope');
    });

    const id = await queue.enqueue({ type: 'capped' });

    queue.start();
    await advancePolls(t.mock.timers, 100, 100);
    queue.stop();

    const job = pool.jobs.get(id);
    assert.ok(job, 'Job should be retained for retry');
    assert.equal(
      job!.run_at.getTime(),
      Date.now() + policy.maxDelayMs,
      'run_at delay should be capped at maxDelayMs',
    );
  });
});

// ── Tests: DLQ promotion on retry exhaustion ─────────────────────────────────

describe('JobQueue polling loop — DLQ promotion (attempt_count >= maxAttempts)', () => {
  it('moves a job with no retry policy (maxAttempts defaults to 1) straight to the DLQ on first failure', async (t) => {
    const T0 = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });

    const pool = makeStatefulPool();
    const queue = new JobQueue(pool, { pollIntervalMs: 100, concurrency: 5 });

    queue.register('permanent-fail', async () => {
      throw new Error('cannot recover');
    });

    const id = await queue.enqueue({ type: 'permanent-fail', payload: { foo: 'bar' } });
    assert.ok(pool.jobs.has(id), 'Job should be persisted before polling');

    queue.start();
    await advancePolls(t.mock.timers, 100, 100); // one poll cycle: fails and exhausts (maxAttempts=1)
    queue.stop();

    assert.ok(!pool.jobs.has(id), 'Exhausted job must be removed from street_jobs');
    assert.equal(pool.dlq.length, 1, 'Exhausted job must be inserted into the DLQ');
    assert.equal(pool.dlq[0].job_id, id, 'DLQ row should preserve the original job id');
    assert.equal(pool.dlq[0].type, 'permanent-fail', 'DLQ row should preserve the job type');
    assert.equal(pool.dlq[0].error, 'cannot recover', 'DLQ row should preserve the final error message');
  });

  it('moves a job to the DLQ only after exhausting all retry attempts', async (t) => {
    const T0 = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });

    const pool = makeStatefulPool();
    const queue = new JobQueue(pool, { pollIntervalMs: 100, concurrency: 5 });

    const policy = { maxAttempts: 3, initialDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 10_000 };
    queue.setRetryPolicy('flaky', policy);
    queue.register('flaky', async () => {
      throw new Error('still broken');
    });

    const id = await queue.enqueue({ type: 'flaky' });

    queue.start();

    // Attempt 0 -> fails, reschedules (attempt_count = 1), delay = 100ms.
    await advancePolls(t.mock.timers, 100, 100);
    assert.ok(pool.jobs.has(id), 'Job should still be queued after first failure (attempts remain)');
    assert.equal(pool.dlq.length, 0, 'Job should not be in DLQ before exhausting retries');
    assert.equal(pool.jobs.get(id)!.attempt_count, 1);

    // Attempt 1 -> fails, reschedules (attempt_count = 2), delay = 200ms.
    await advancePolls(t.mock.timers, 200, 100);
    assert.ok(pool.jobs.has(id), 'Job should still be queued after second failure');
    assert.equal(pool.dlq.length, 0, 'Job should still not be in DLQ');
    assert.equal(pool.jobs.get(id)!.attempt_count, 2);

    // Attempt 2 -> fails, attempt_count would reach 3 >= maxAttempts -> DLQ promotion.
    await advancePolls(t.mock.timers, 400, 100);
    queue.stop();

    assert.ok(!pool.jobs.has(id), 'Job must be removed from street_jobs after exhausting retries');
    assert.equal(pool.dlq.length, 1, 'Job must land in the DLQ after exhausting retries');
    assert.equal(pool.dlq[0].job_id, id);
    assert.equal(pool.dlq[0].error, 'still broken');
  });

  it('performs the DLQ INSERT and the street_jobs DELETE within a single transaction', async (t) => {
    const T0 = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });

    const pool = makeStatefulPool();
    const queue = new JobQueue(pool, { pollIntervalMs: 100, concurrency: 5 });

    queue.register('to-dlq', async () => {
      throw new Error('boom');
    });

    const id = await queue.enqueue({ type: 'to-dlq' });

    queue.start();
    await advancePolls(t.mock.timers, 100, 100);
    queue.stop();

    // Exactly one transaction should have been opened for the DLQ promotion.
    assert.equal(pool.transactions.length, 1, 'DLQ promotion should occur in exactly one transaction');

    const txn = pool.transactions[0];
    const insertStmt = txn.find((s) => s.sql.includes('INSERT INTO street_dead_letter_queue'));
    const deleteStmt = txn.find((s) => s.sql.includes('DELETE FROM street_jobs'));

    assert.ok(insertStmt, 'The transaction must contain the DLQ INSERT');
    assert.ok(deleteStmt, 'The transaction must contain the street_jobs DELETE');

    // Both writes must target the same job id within that one transaction.
    assert.equal((insertStmt!.params as unknown[])[0], id, 'DLQ INSERT must reference the job id');
    assert.equal((deleteStmt!.params as unknown[])[0], id, 'DELETE must reference the same job id');

    // The INSERT must precede the DELETE (insert into DLQ, then remove from queue).
    assert.ok(
      txn.indexOf(insertStmt!) < txn.indexOf(deleteStmt!),
      'INSERT into DLQ should happen before DELETE from street_jobs in the same transaction',
    );
  });

  it('rolls back the DELETE atomically if the DLQ INSERT fails (no partial promotion)', async (t) => {
    const T0 = 1_700_000_000_000;
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: T0 });

    // Configure the pool so the DLQ INSERT throws inside the transaction.
    const pool = makeStatefulPool({ failDlqInsert: true });
    const queue = new JobQueue(pool, { pollIntervalMs: 100, concurrency: 5 });

    queue.register('to-dlq', async () => {
      throw new Error('boom');
    });

    const id = await queue.enqueue({ type: 'to-dlq' });

    queue.start();
    await advancePolls(t.mock.timers, 100, 100);
    queue.stop();

    // The transaction failed, so the DELETE must have been rolled back: the job
    // must NOT have been removed by a half-completed promotion.
    assert.equal(pool.dlq.length, 0, 'No DLQ row should be committed when the INSERT fails');
    assert.ok(pool.jobs.has(id), 'Job must remain (DELETE rolled back) when the DLQ INSERT fails');
  });
});

// ── Tests: DLQ pruning (bounded dead letter queue) ───────────────────────────

/**
 * A focused mock pool that records the pruning DELETE and emulates its semantics
 * against an in-memory set of DLQ rows. This lets us assert both that the query
 * is correct (shape + bound param) and that the table is bounded after pruning.
 */
function makeDlqPrunePool(initialRows: Array<{ id: string; created_at: number }> = []): JobQueuePool & {
  dlqRows: Array<{ id: string; created_at: number }>;
  queries: Array<{ sql: string; params?: unknown[] }>;
} {
  const dlqRows = [...initialRows];
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  return {
    dlqRows,
    queries,
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      queries.push({ sql, params });

      if (sql.includes('DELETE FROM street_dead_letter_queue')) {
        const limit = (params as unknown[])[0] as number;
        // Keep the newest `limit` rows by created_at DESC; delete the rest.
        const keep = new Set(
          [...dlqRows]
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, limit)
            .map((r) => r.id),
        );
        const before = dlqRows.length;
        for (let i = dlqRows.length - 1; i >= 0; i--) {
          if (!keep.has(dlqRows[i].id)) dlqRows.splice(i, 1);
        }
        const deleted = before - dlqRows.length;
        return { rows: [], rowCount: deleted, command: 'DELETE' };
      }

      return { rows: [], rowCount: 0, command: 'SELECT' };
    },
    async transaction<T>(fn: (conn: { query(sql: string, params?: unknown[]): Promise<QueryResult> }) => Promise<T>): Promise<T> {
      return fn({ query: (sql, params) => this.query(sql, params) });
    },
  };
}

describe('JobQueue.pruneDeadLetterQueue', () => {
  it('issues the correct bounded DELETE ... WHERE id NOT IN (SELECT ... ORDER BY created_at DESC LIMIT $1)', async () => {
    const pool = makeDlqPrunePool();
    const queue = new JobQueue(pool);

    await queue.pruneDeadLetterQueue(100);

    const del = pool.queries.find((q) => q.sql.includes('DELETE FROM street_dead_letter_queue'));
    assert.ok(del, 'Expected a DELETE against street_dead_letter_queue');
    assert.match(del!.sql, /DELETE FROM street_dead_letter_queue/i, 'targets the DLQ table');
    assert.match(del!.sql, /WHERE\s+id\s+NOT\s+IN/i, 'uses WHERE id NOT IN');
    assert.match(del!.sql, /SELECT\s+id\s+FROM\s+street_dead_letter_queue/i, 'inner SELECT on the DLQ table');
    assert.match(del!.sql, /ORDER BY\s+created_at\s+DESC/i, 'keeps newest by created_at DESC');
    assert.match(del!.sql, /LIMIT\s+\$1/i, 'bounds the kept set with a parameterized LIMIT');
    assert.deepEqual(del!.params, [100], 'binds maxEntries as the LIMIT parameter');
  });

  it('bounds the table to at most maxEntries rows, keeping the most recent entries', async () => {
    // 5 rows with ascending created_at; ids r1..r5 (r5 is newest).
    const rows = [
      { id: 'r1', created_at: 1_000 },
      { id: 'r2', created_at: 2_000 },
      { id: 'r3', created_at: 3_000 },
      { id: 'r4', created_at: 4_000 },
      { id: 'r5', created_at: 5_000 },
    ];
    const pool = makeDlqPrunePool(rows);
    const queue = new JobQueue(pool);

    const deleted = await queue.pruneDeadLetterQueue(2);

    assert.equal(deleted, 3, 'Should delete the 3 oldest rows');
    assert.equal(pool.dlqRows.length, 2, 'Table must be bounded to maxEntries rows');
    const keptIds = pool.dlqRows.map((r) => r.id).sort();
    assert.deepEqual(keptIds, ['r4', 'r5'], 'The two most recent rows must be retained');
  });

  it('is a no-op when the table already has fewer rows than maxEntries', async () => {
    const rows = [
      { id: 'r1', created_at: 1_000 },
      { id: 'r2', created_at: 2_000 },
    ];
    const pool = makeDlqPrunePool(rows);
    const queue = new JobQueue(pool);

    const deleted = await queue.pruneDeadLetterQueue(10);

    assert.equal(deleted, 0, 'Nothing should be deleted when under the limit');
    assert.equal(pool.dlqRows.length, 2, 'All rows retained when under the limit');
  });

  it('rejects a negative or non-integer maxEntries', async () => {
    const pool = makeDlqPrunePool();
    const queue = new JobQueue(pool);

    await assert.rejects(() => queue.pruneDeadLetterQueue(-1), /non-negative integer/);
    await assert.rejects(() => queue.pruneDeadLetterQueue(1.5), /non-negative integer/);
  });
});

describe('JobQueue.registerDlqPruning', () => {
  it('registers a nightly cron job (default 0 0 * * *) that prunes the DLQ when fired', async () => {
    const pool = makeDlqPrunePool([
      { id: 'r1', created_at: 1_000 },
      { id: 'r2', created_at: 2_000 },
      { id: 'r3', created_at: 3_000 },
    ]);
    const queue = new JobQueue(pool);
    const sched = new CronScheduler();

    queue.registerDlqPruning(sched, 1);

    // Confirm a job was registered under the expected name with the default schedule.
    const jobs = (sched as unknown as { jobs: Map<string, { fn: () => Promise<void> }> }).jobs;
    assert.ok(jobs.has('street:dlq-prune'), 'A cron entry named street:dlq-prune should be registered');

    // Fire the registered function directly and verify the prune ran and bounded the table.
    await jobs.get('street:dlq-prune')!.fn();

    const del = pool.queries.find((q) => q.sql.includes('DELETE FROM street_dead_letter_queue'));
    assert.ok(del, 'Firing the cron job should issue the prune DELETE');
    assert.deepEqual(del!.params, [1], 'The prune should use the configured maxEntries');
    assert.equal(pool.dlqRows.length, 1, 'DLQ should be bounded to maxEntries after the nightly run');
    assert.equal(pool.dlqRows[0].id, 'r3', 'The most recent entry should be retained');
  });

  it('accepts a custom cron expression and rejects an invalid one via the scheduler', () => {
    const pool = makeDlqPrunePool();
    const queue = new JobQueue(pool);
    const sched = new CronScheduler();

    assert.doesNotThrow(() => queue.registerDlqPruning(sched, 500, '30 3 * * *'));
    assert.throws(
      () => queue.registerDlqPruning(sched, 500, 'not a cron'),
      (err: unknown) => err instanceof CronParseError,
    );
  });

  it('rejects a negative maxEntries before registering', () => {
    const pool = makeDlqPrunePool();
    const queue = new JobQueue(pool);
    const sched = new CronScheduler();
    assert.throws(() => queue.registerDlqPruning(sched, -5), /non-negative integer/);
  });
});

// ── Stateful workflow pool ────────────────────────────────────────────────────

interface StoredWorkflow {
  id: string;
  name: string;
  status: string;
  current_step: number;
  step_outputs: string; // JSON-serialized, mirroring the JSONB-as-text read convention
  input: string;        // JSON-serialized
  error: string | null;
}

/**
 * A stateful in-memory pool that honours the real street_workflows persistence
 * contract used by WorkflowEngine.resume():
 *  - INSERT stores a pending workflow row with its serialized input.
 *  - SELECT returns name/status/current_step/step_outputs/input as a text row
 *    (JSONB columns are returned as strings, matching the driver convention).
 *  - The status/current_step UPDATE and the step_outputs/current_step UPDATE
 *    mutate the stored row exactly as Postgres would.
 *  - Advisory lock queries (pg_try_advisory_lock / pg_advisory_unlock) succeed,
 *    so the DistributedLock guard inside resume() can be exercised end-to-end.
 *
 * This lets a workflow be driven through the genuine start -> resume path and,
 * crucially, lets a *fresh* engine call resume() against an existing row to
 * assert restart/skip behaviour.
 */
function makeWorkflowPool(opts: { workflow?: Partial<StoredWorkflow> } = {}): JobQueuePool & {
  workflows: Map<string, StoredWorkflow>;
  queries: Array<{ sql: string; params?: unknown[] }>;
} {
  const workflows = new Map<string, StoredWorkflow>();
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  let seq = 0;

  // Seed an existing workflow row when provided (used for restart tests).
  if (opts.workflow) {
    const wf: StoredWorkflow = {
      id: opts.workflow.id ?? 'wf-seed',
      name: opts.workflow.name ?? 'unknown',
      status: opts.workflow.status ?? 'running',
      current_step: opts.workflow.current_step ?? 0,
      step_outputs: opts.workflow.step_outputs ?? '{}',
      input: opts.workflow.input ?? '{}',
      error: opts.workflow.error ?? null,
    };
    workflows.set(wf.id, wf);
  }

  const pool: JobQueuePool & {
    workflows: Map<string, StoredWorkflow>;
    queries: Array<{ sql: string; params?: unknown[] }>;
  } = {
    workflows,
    queries,
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      const args = (params ?? []) as unknown[];
      queries.push({ sql, params });

      // Distributed-lock advisory queries used by resume().
      if (sql.includes('pg_try_advisory_lock')) {
        return { rows: [{ acquired: true } as unknown as Record<string, string | null>], rowCount: 1, command: 'SELECT' };
      }
      if (sql.includes('pg_advisory_unlock')) {
        return { rows: [], rowCount: 1, command: 'SELECT' };
      }

      if (sql.includes('INSERT INTO street_workflows') && sql.includes('RETURNING id')) {
        const id = `wf-${++seq}`;
        workflows.set(id, {
          id,
          name: args[0] as string,
          status: 'pending',
          current_step: 0,
          step_outputs: '{}',
          input: args[1] as string,
          error: null,
        });
        return { rows: [{ id }], rowCount: 1, command: 'INSERT' };
      }

      if (sql.includes('SELECT') && sql.includes('FROM street_workflows WHERE id=')) {
        const wf = workflows.get(args[0] as string);
        if (!wf) return { rows: [], rowCount: 0, command: 'SELECT' };
        return {
          rows: [{
            name: wf.name,
            status: wf.status,
            current_step: String(wf.current_step),
            step_outputs: wf.step_outputs,
            input: wf.input,
          }],
          rowCount: 1,
          command: 'SELECT',
        };
      }

      // UPDATE ... SET status='running', current_step=$1 ... WHERE id=$2
      if (sql.includes("UPDATE street_workflows SET status='running'")) {
        const wf = workflows.get(args[1] as string);
        if (wf) {
          wf.status = 'running';
          wf.current_step = args[0] as number;
        }
        return { rows: [], rowCount: 1, command: 'UPDATE' };
      }

      // UPDATE ... SET step_outputs=$1::jsonb, current_step=$2 ... WHERE id=$3
      if (sql.includes('SET step_outputs=')) {
        const wf = workflows.get(args[2] as string);
        if (wf) {
          wf.step_outputs = args[0] as string;
          wf.current_step = args[1] as number;
        }
        return { rows: [], rowCount: 1, command: 'UPDATE' };
      }

      // UPDATE ... SET status='completed' ... WHERE id=$1
      if (sql.includes("UPDATE street_workflows SET status='completed'")) {
        const wf = workflows.get(args[0] as string);
        if (wf) wf.status = 'completed';
        return { rows: [], rowCount: 1, command: 'UPDATE' };
      }

      // UPDATE ... SET status='failed', error=$1 ... WHERE id=$2
      if (sql.includes("UPDATE street_workflows SET status='failed'")) {
        const wf = workflows.get(args[1] as string);
        if (wf) {
          wf.status = 'failed';
          wf.error = args[0] as string;
        }
        return { rows: [], rowCount: 1, command: 'UPDATE' };
      }

      // UPDATE ... SET status=$1, error=$2 ... WHERE id=$3
      // (parameterized terminal status: 'failed' or 'timed_out')
      if (sql.includes('UPDATE street_workflows SET status=$1, error=$2')) {
        const wf = workflows.get(args[2] as string);
        if (wf) {
          wf.status = args[0] as string;
          wf.error = args[1] as string;
        }
        return { rows: [], rowCount: 1, command: 'UPDATE' };
      }

      return { rows: [], rowCount: 0, command: 'SELECT' };
    },
    async transaction<T>(
      fn: (conn: { query(sql: string, params?: unknown[]): Promise<QueryResult> }) => Promise<T>,
    ): Promise<T> {
      return fn({ query: (sql, params) => pool.query(sql, params) });
    },
  };

  return pool;
}

// ── Tests: WorkflowEngine step execution and persistence (Requirement 24.1) ────

describe('WorkflowEngine — step execution and persistence', () => {
  it('runs each step in order, chaining outputs, and completes the workflow', async () => {
    const pool = makeWorkflowPool();
    const engine = new WorkflowEngine(pool);

    const seen: unknown[] = [];
    const steps: WorkflowStep[] = [
      { name: 'double', run: async (input) => { seen.push(input); return (input as number) * 2; } },
      { name: 'inc', run: async (input) => { seen.push(input); return (input as number) + 1; } },
      { name: 'stringify', run: async (input) => { seen.push(input); return `value=${input}`; } },
    ];
    engine.define('math', steps);

    const id = await engine.start('math', 5);

    // Each step received the previous step's output (5 -> 10 -> 11).
    assert.deepEqual(seen, [5, 10, 11], 'Steps should chain outputs as inputs');

    const wf = pool.workflows.get(id)!;
    assert.equal(wf.status, 'completed', 'Workflow should be marked completed');
    assert.equal(wf.current_step, 3, 'current_step should advance past the last step');

    // step_outputs must hold the serialized output of every step, keyed by name.
    const outputs = JSON.parse(wf.step_outputs) as Record<string, unknown>;
    assert.deepEqual(outputs, { double: 10, inc: 11, stringify: 'value=11' });
  });

  it('persists step_outputs[stepName] and current_step incrementally after each successful step', async () => {
    const pool = makeWorkflowPool();
    const engine = new WorkflowEngine(pool);

    // Snapshot the persisted state at the moment each step's output is recorded.
    const snapshots: Array<{ current_step: number; outputs: Record<string, unknown> }> = [];
    const steps: WorkflowStep[] = [
      { name: 'a', run: async () => 'A' },
      { name: 'b', run: async () => 'B' },
    ];
    engine.define('letters', steps);

    // Observe each step_outputs UPDATE as it happens.
    const originalQuery = pool.query.bind(pool);
    (pool as { query: JobQueuePool['query'] }).query = async (sql: string, params?: unknown[]) => {
      const res = await originalQuery(sql, params);
      if (sql.includes('SET step_outputs=')) {
        snapshots.push({
          current_step: params![1] as number,
          outputs: JSON.parse(params![0] as string) as Record<string, unknown>,
        });
      }
      return res;
    };

    await engine.start('letters', null);

    assert.equal(snapshots.length, 2, 'There should be one persistence write per completed step');
    // After step 0 (a): output recorded, current_step advanced to 1.
    assert.deepEqual(snapshots[0], { current_step: 1, outputs: { a: 'A' } });
    // After step 1 (b): both outputs present, current_step advanced to 2.
    assert.deepEqual(snapshots[1], { current_step: 2, outputs: { a: 'A', b: 'B' } });
  });
});

// ── Tests: WorkflowEngine resume after restart (Requirement 24.2) ──────────────

describe('WorkflowEngine — resume skips already-recorded steps', () => {
  it('on restart, resume() reads current_step + step_outputs and does not re-run completed steps', async () => {
    // Simulate a process that already completed step 0 ('first') before crashing:
    // current_step=1 and step_outputs has the recorded output of 'first'.
    const pool = makeWorkflowPool({
      workflow: {
        id: 'wf-restart',
        name: 'pipeline',
        status: 'running',
        current_step: 1,
        step_outputs: JSON.stringify({ first: 'first-output' }),
        input: JSON.stringify('original-input'),
      },
    });

    // A fresh engine (as after a restart) re-registers the definition.
    const engine = new WorkflowEngine(pool);
    const ran: string[] = [];
    const inputs: unknown[] = [];
    const steps: WorkflowStep[] = [
      { name: 'first', run: async () => { ran.push('first'); return 'first-output'; } },
      { name: 'second', run: async (input) => { ran.push('second'); inputs.push(input); return 'second-output'; } },
    ];
    engine.define('pipeline', steps);

    await engine.resume('wf-restart');

    // 'first' must NOT have re-executed; only 'second' runs.
    assert.deepEqual(ran, ['second'], 'Completed step must be skipped on resume');
    // 'second' receives the recorded output of the skipped 'first' step.
    assert.deepEqual(inputs, ['first-output'], 'Resumed step receives the prior recorded output');

    const wf = pool.workflows.get('wf-restart')!;
    assert.equal(wf.status, 'completed', 'Workflow completes after resuming remaining steps');
    const outputs = JSON.parse(wf.step_outputs) as Record<string, unknown>;
    assert.deepEqual(outputs, { first: 'first-output', second: 'second-output' });
  });

  it('is a no-op for a workflow already in a terminal state', async () => {
    const pool = makeWorkflowPool({
      workflow: { id: 'wf-done', name: 'pipeline', status: 'completed', current_step: 2 },
    });
    const engine = new WorkflowEngine(pool);
    const ran: string[] = [];
    engine.define('pipeline', [
      { name: 'first', run: async () => { ran.push('first'); return 1; } },
      { name: 'second', run: async () => { ran.push('second'); return 2; } },
    ]);

    await engine.resume('wf-done');

    assert.deepEqual(ran, [], 'No steps should run for a completed workflow');
  });
});

// ── Tests: WorkflowEngine step timeout (Requirement 24.5) ─────────────────────

describe('WorkflowEngine — step timeout', () => {
  it('marks the workflow timed_out (not failed) and runs compensation for completed steps when a step hangs past its timeoutMs', async () => {
    const pool = makeWorkflowPool();
    const engine = new WorkflowEngine(pool);

    const compensated: string[] = [];
    let hangTimer: ReturnType<typeof setTimeout> | undefined;
    const steps: WorkflowStep[] = [
      {
        name: 'reserve',
        run: async () => 'reserved',
        compensate: async () => { compensated.push('reserve'); },
      },
      {
        // This step never resolves on its own — it must be cut off by timeoutMs.
        name: 'charge',
        timeoutMs: 20,
        run: () => new Promise<unknown>((resolve) => {
          // Keep the loop alive (no unref) so the engine's timeout can fire;
          // cleared at the end of the test.
          hangTimer = setTimeout(() => resolve('charged'), 10_000);
        }),
        compensate: async () => { compensated.push('charge'); },
      },
    ];
    engine.define('payment', steps);

    const id = await engine.start('payment', null);

    const wf = pool.workflows.get(id)!;
    assert.equal(wf.status, 'timed_out', 'Hung step should leave the workflow in timed_out state');
    assert.match(wf.error ?? '', /timed out after 20ms/, 'Error should record the timeout');

    // Saga compensation runs in reverse for steps completed before the timeout.
    // 'charge' never completed, so only 'reserve' is compensated.
    assert.deepEqual(compensated, ['reserve'], 'Completed step should be compensated on timeout');

    if (hangTimer) clearTimeout(hangTimer);
  });

  it('keeps status failed (not timed_out) for an ordinary step error', async () => {
    const pool = makeWorkflowPool();
    const engine = new WorkflowEngine(pool);

    const compensated: string[] = [];
    const steps: WorkflowStep[] = [
      {
        name: 'reserve',
        run: async () => 'reserved',
        compensate: async () => { compensated.push('reserve'); },
      },
      {
        name: 'charge',
        timeoutMs: 1_000, // generous timeout — the step rejects well before it
        run: async () => { throw new Error('card declined'); },
        compensate: async () => { compensated.push('charge'); },
      },
    ];
    engine.define('payment', steps);

    const id = await engine.start('payment', null);

    const wf = pool.workflows.get(id)!;
    assert.equal(wf.status, 'failed', 'A thrown error should mark the workflow failed, not timed_out');
    assert.equal(wf.error, 'card declined', 'Error message should be recorded');
    assert.deepEqual(compensated, ['reserve'], 'Completed step should still be compensated on failure');
  });

  it('WorkflowStepTimeoutError carries the step name and timeout duration', () => {
    const err = new WorkflowStepTimeoutError('charge', 20);
    assert.ok(err instanceof Error);
    assert.equal(err.stepName, 'charge');
    assert.equal(err.timeoutMs, 20);
    assert.match(err.message, /Step "charge" timed out after 20ms/);
  });
});

// ── Tests: WorkflowEngine Saga compensation (Requirement 24.3) ────────────────

describe('WorkflowEngine — Saga compensation', () => {
  it('runs compensate() for completed steps in reverse order when a later step fails', async () => {
    const pool = makeWorkflowPool();
    const engine = new WorkflowEngine(pool);

    const compensated: string[] = [];
    const steps: WorkflowStep[] = [
      { name: 'reserve', run: async () => 'reserved', compensate: async () => { compensated.push('reserve'); } },
      { name: 'charge', run: async () => 'charged', compensate: async () => { compensated.push('charge'); } },
      { name: 'ship', run: async () => 'shipped', compensate: async () => { compensated.push('ship'); } },
      // The final step fails after three steps have completed.
      { name: 'notify', run: async () => { throw new Error('notify failed'); }, compensate: async () => { compensated.push('notify'); } },
    ];
    engine.define('order', steps);

    const id = await engine.start('order', null);

    const wf = pool.workflows.get(id)!;
    assert.equal(wf.status, 'failed', 'Workflow should be marked failed when a step throws');
    assert.equal(wf.error, 'notify failed', 'Failure error should be recorded');

    // 'notify' never completed (it threw), so only the three completed steps are
    // compensated, and strictly in reverse completion order.
    assert.deepEqual(
      compensated,
      ['ship', 'charge', 'reserve'],
      'Completed steps must be compensated in reverse order',
    );
  });

  it('continues compensating remaining steps even if one compensation throws (errors logged, not re-thrown)', async () => {
    const pool = makeWorkflowPool();
    const engine = new WorkflowEngine(pool);

    const compensated: string[] = [];

    // Capture stderr so we can assert the failing compensation is logged rather
    // than propagated (which would abort the remaining rollback).
    const stderrLines: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: typeof process.stderr.write }).write = ((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const steps: WorkflowStep[] = [
        { name: 'reserve', run: async () => 'reserved', compensate: async () => { compensated.push('reserve'); } },
        // This middle compensation throws; it must not stop 'reserve' from compensating.
        { name: 'charge', run: async () => 'charged', compensate: async () => { compensated.push('charge'); throw new Error('refund failed'); } },
        { name: 'ship', run: async () => { throw new Error('ship failed'); }, compensate: async () => { compensated.push('ship'); } },
      ];
      engine.define('order', steps);

      // resume() must resolve (not reject) despite the compensation error.
      const id = await engine.start('order', null);

      const wf = pool.workflows.get(id)!;
      assert.equal(wf.status, 'failed', 'Workflow should be failed after the step error');
      assert.equal(wf.error, 'ship failed', 'Original step failure should be recorded');

      // 'ship' threw so it is not compensated; 'charge' compensates (and throws),
      // and 'reserve' still compensates afterwards — proving the loop is not aborted.
      assert.deepEqual(
        compensated,
        ['charge', 'reserve'],
        'A throwing compensation must not prevent remaining compensations from running',
      );

      // The compensation error is surfaced via stderr rather than re-thrown.
      assert.ok(
        stderrLines.some((line) => line.includes('Compensation error') && line.includes('charge') && line.includes('refund failed')),
        'Compensation error should be logged to stderr',
      );
    } finally {
      (process.stderr as { write: typeof process.stderr.write }).write = originalWrite;
    }
  });
});

// ── Tests: WorkflowEngine conditional branching (Requirement 24.4) ────────────

describe('WorkflowEngine — conditional branching', () => {
  it('skips a step whose condition evaluates false and passes the prior input through unchanged', async () => {
    const pool = makeWorkflowPool();
    const engine = new WorkflowEngine(pool);

    const ran: string[] = [];
    const conditionInputs: unknown[] = [];
    const steps: WorkflowStep[] = [
      { name: 'prepare', run: async (input) => { ran.push('prepare'); return { amount: input }; } },
      {
        name: 'applyDiscount',
        // Branch predicate sees the prior step's output; large orders only.
        condition: (input) => {
          conditionInputs.push(input);
          return (input as { amount: number }).amount >= 100;
        },
        run: async (input) => {
          ran.push('applyDiscount');
          return { amount: (input as { amount: number }).amount * 0.9 };
        },
      },
      { name: 'finalize', run: async (input) => { ran.push('finalize'); return input; } },
    ];
    engine.define('checkout', steps);

    const id = await engine.start('checkout', 50);

    // amount 50 < 100 → the branch predicate is false, so applyDiscount.run() is skipped.
    assert.deepEqual(ran, ['prepare', 'finalize'], 'A step with a false condition must not run');
    assert.deepEqual(conditionInputs, [{ amount: 50 }], 'condition receives the prior step output as input');

    const wf = pool.workflows.get(id)!;
    assert.equal(wf.status, 'completed', 'Workflow completes even when a conditional step is skipped');
    assert.equal(wf.current_step, 3, 'current_step advances past the skipped step');

    const outputs = JSON.parse(wf.step_outputs) as Record<string, unknown>;
    assert.deepEqual(outputs.prepare, { amount: 50 });
    // Skipped step records the passed-through value (not a discounted amount)...
    assert.deepEqual(outputs.applyDiscount, { amount: 50 }, 'Skipped step records the passed-through input');
    // ...and the downstream step receives that unchanged value.
    assert.deepEqual(outputs.finalize, { amount: 50 }, 'Downstream step receives the unchanged prior output');
  });

  it('runs a step whose condition evaluates true (branch taken) and chains its transformed output', async () => {
    const pool = makeWorkflowPool();
    const engine = new WorkflowEngine(pool);

    const ran: string[] = [];
    const steps: WorkflowStep[] = [
      { name: 'prepare', run: async () => ({ amount: 200 }) },
      {
        name: 'applyDiscount',
        condition: (input) => (input as { amount: number }).amount >= 100,
        run: async (input) => {
          ran.push('applyDiscount');
          return { amount: (input as { amount: number }).amount * 0.9 };
        },
      },
      { name: 'finalize', run: async (input) => { ran.push('finalize'); return input; } },
    ];
    engine.define('checkout', steps);

    const id = await engine.start('checkout', null);

    // amount 200 >= 100 → the branch is taken and applyDiscount.run() executes.
    assert.deepEqual(ran, ['applyDiscount', 'finalize'], 'A step with a true condition must run');

    const wf = pool.workflows.get(id)!;
    assert.equal(wf.status, 'completed');
    const outputs = JSON.parse(wf.step_outputs) as Record<string, unknown>;
    assert.deepEqual(outputs.applyDiscount, { amount: 180 }, 'Branch-taken step transforms the input');
    assert.deepEqual(outputs.finalize, { amount: 180 }, 'Downstream step receives the transformed output');
  });

  it('does not compensate a skipped step when a later step fails', async () => {
    const pool = makeWorkflowPool();
    const engine = new WorkflowEngine(pool);

    const compensated: string[] = [];
    const steps: WorkflowStep[] = [
      { name: 'reserve', run: async () => 'reserved', compensate: async () => { compensated.push('reserve'); } },
      {
        name: 'fraudCheck',
        condition: () => false, // never runs
        run: async () => 'checked',
        compensate: async () => { compensated.push('fraudCheck'); },
      },
      { name: 'charge', run: async () => { throw new Error('charge failed'); }, compensate: async () => { compensated.push('charge'); } },
    ];
    engine.define('order', steps);

    const id = await engine.start('order', null);

    const wf = pool.workflows.get(id)!;
    assert.equal(wf.status, 'failed', 'Workflow fails when the final step throws');
    // 'charge' threw (not compensated); 'fraudCheck' was skipped (never ran, so no
    // compensation); only the genuinely-completed 'reserve' step is compensated.
    assert.deepEqual(compensated, ['reserve'], 'A skipped conditional step must not be compensated');
  });
});

// ── Tests: Job history pruning (bounded per-type history) ─────────────────────

/**
 * A focused mock pool that records the pruning DELETE and emulates its window
 * semantics against an in-memory set of history rows. This lets us assert both
 * that the query is correct (window function + bound param) and that each job
 * type is independently bounded after pruning.
 */
function makeJobHistoryPrunePool(
  initialRows: Array<{ id: string; type: string; created_at: number }> = [],
): JobQueuePool & {
  historyRows: Array<{ id: string; type: string; created_at: number }>;
  queries: Array<{ sql: string; params?: unknown[] }>;
} {
  const historyRows = [...initialRows];
  const queries: Array<{ sql: string; params?: unknown[] }> = [];

  return {
    historyRows,
    queries,
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      queries.push({ sql, params });

      if (sql.includes('DELETE FROM street_job_history')) {
        const maxPerType = (params as unknown[])[0] as number;
        // Keep the newest `maxPerType` rows by created_at DESC within each type;
        // delete the rest (rn > maxPerType), mirroring the window function.
        const keep = new Set<string>();
        const byType = new Map<string, Array<{ id: string; created_at: number }>>();
        for (const r of historyRows) {
          const list = byType.get(r.type) ?? [];
          list.push({ id: r.id, created_at: r.created_at });
          byType.set(r.type, list);
        }
        for (const list of byType.values()) {
          list
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, maxPerType)
            .forEach((r) => keep.add(r.id));
        }
        const before = historyRows.length;
        for (let i = historyRows.length - 1; i >= 0; i--) {
          if (!keep.has(historyRows[i].id)) historyRows.splice(i, 1);
        }
        const deleted = before - historyRows.length;
        return { rows: [], rowCount: deleted, command: 'DELETE' };
      }

      return { rows: [], rowCount: 0, command: 'SELECT' };
    },
    async transaction<T>(fn: (conn: { query(sql: string, params?: unknown[]): Promise<QueryResult> }) => Promise<T>): Promise<T> {
      return fn({ query: (sql, params) => this.query(sql, params) });
    },
  };
}

describe('JobQueue.pruneJobHistory', () => {
  it('issues a window-function DELETE keeping the newest maxPerType rows per type', async () => {
    const pool = makeJobHistoryPrunePool();
    const queue = new JobQueue(pool);

    await queue.pruneJobHistory(1_000);

    const del = pool.queries.find((q) => q.sql.includes('DELETE FROM street_job_history'));
    assert.ok(del, 'Expected a DELETE against street_job_history');
    assert.match(del!.sql, /DELETE FROM street_job_history/i, 'targets the history table');
    assert.match(del!.sql, /ROW_NUMBER\(\)\s+OVER/i, 'uses a ROW_NUMBER() window function');
    assert.match(del!.sql, /PARTITION BY\s+type/i, 'partitions per job type');
    assert.match(del!.sql, /ORDER BY\s+created_at\s+DESC/i, 'orders newest first within each type');
    assert.match(del!.sql, /rn\s*>\s*\$1/i, 'deletes rows ranked beyond the parameterized bound');
    assert.deepEqual(del!.params, [1_000], 'binds maxPerType as the bound parameter');
  });

  it('bounds each type independently to at most maxPerType rows, keeping the most recent', async () => {
    const rows = [
      { id: 'a1', type: 'email', created_at: 1_000 },
      { id: 'a2', type: 'email', created_at: 2_000 },
      { id: 'a3', type: 'email', created_at: 3_000 },
      { id: 'b1', type: 'report', created_at: 1_500 },
      { id: 'b2', type: 'report', created_at: 2_500 },
    ];
    const pool = makeJobHistoryPrunePool(rows);
    const queue = new JobQueue(pool);

    const deleted = await queue.pruneJobHistory(1);

    assert.equal(deleted, 3, 'Should delete all but the newest row per type');
    const keptIds = pool.historyRows.map((r) => r.id).sort();
    assert.deepEqual(keptIds, ['a3', 'b2'], 'Only the newest row of each type is retained');
  });

  it('is a no-op when every type already has fewer rows than maxPerType', async () => {
    const rows = [
      { id: 'a1', type: 'email', created_at: 1_000 },
      { id: 'b1', type: 'report', created_at: 2_000 },
    ];
    const pool = makeJobHistoryPrunePool(rows);
    const queue = new JobQueue(pool);

    const deleted = await queue.pruneJobHistory(1_000);

    assert.equal(deleted, 0, 'Nothing should be deleted when under the per-type limit');
    assert.equal(pool.historyRows.length, 2, 'All rows retained when under the limit');
  });

  it('rejects a negative or non-integer maxPerType', async () => {
    const pool = makeJobHistoryPrunePool();
    const queue = new JobQueue(pool);

    await assert.rejects(() => queue.pruneJobHistory(-1), /non-negative integer/);
    await assert.rejects(() => queue.pruneJobHistory(1.5), /non-negative integer/);
  });
});

describe('JobQueue.registerJobHistoryPruning', () => {
  it('registers a nightly cron job (default 0 0 * * *, keep 1000/type) that prunes history when fired', async () => {
    const rows = [
      { id: 'a1', type: 'email', created_at: 1_000 },
      { id: 'a2', type: 'email', created_at: 2_000 },
      { id: 'a3', type: 'email', created_at: 3_000 },
    ];
    const pool = makeJobHistoryPrunePool(rows);
    const queue = new JobQueue(pool);
    const sched = new CronScheduler();

    queue.registerJobHistoryPruning(sched, 1);

    const jobs = (sched as unknown as { jobs: Map<string, { fn: () => Promise<void> }> }).jobs;
    assert.ok(jobs.has('street:job-history-prune'), 'A cron entry named street:job-history-prune should be registered');

    await jobs.get('street:job-history-prune')!.fn();

    const del = pool.queries.find((q) => q.sql.includes('DELETE FROM street_job_history'));
    assert.ok(del, 'Firing the cron job should issue the prune DELETE');
    assert.deepEqual(del!.params, [1], 'The prune should use the configured maxPerType');
    assert.equal(pool.historyRows.length, 1, 'History should be bounded per type after the nightly run');
    assert.equal(pool.historyRows[0].id, 'a3', 'The most recent entry should be retained');
  });

  it('defaults to keeping 1000 rows per type when maxPerType is omitted', async () => {
    const pool = makeJobHistoryPrunePool();
    const queue = new JobQueue(pool);
    const sched = new CronScheduler();

    queue.registerJobHistoryPruning(sched);

    const jobs = (sched as unknown as { jobs: Map<string, { fn: () => Promise<void> }> }).jobs;
    await jobs.get('street:job-history-prune')!.fn();

    const del = pool.queries.find((q) => q.sql.includes('DELETE FROM street_job_history'));
    assert.ok(del, 'Firing the cron job should issue the prune DELETE');
    assert.deepEqual(del!.params, [1_000], 'The default maxPerType should be 1000');
  });

  it('accepts a custom cron expression and rejects an invalid one via the scheduler', () => {
    const pool = makeJobHistoryPrunePool();
    const queue = new JobQueue(pool);
    const sched = new CronScheduler();

    assert.doesNotThrow(() => queue.registerJobHistoryPruning(sched, 500, '30 3 * * *'));
    assert.throws(
      () => queue.registerJobHistoryPruning(sched, 500, 'not a cron'),
      (err: unknown) => err instanceof CronParseError,
    );
  });

  it('rejects a negative maxPerType before registering', () => {
    const pool = makeJobHistoryPrunePool();
    const queue = new JobQueue(pool);
    const sched = new CronScheduler();
    assert.throws(() => queue.registerJobHistoryPruning(sched, -5), /non-negative integer/);
  });
});

// ── Tests: Worker heartbeat ───────────────────────────────────────────────────

/** Structural view of JobQueue internals used to drive the heartbeat/reaper directly. */
interface JobQueueInternals {
  inFlight: Set<string>;
  _heartbeat(): Promise<void>;
  _reapStaleJobs(): Promise<number>;
}

/** A recording pool that captures every query without mutating any state. */
function makeRecordingPool(): JobQueuePool & { queries: Array<{ sql: string; params?: unknown[] }> } {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    queries,
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0, command: 'UPDATE' };
    },
    async transaction<T>(fn: (conn: { query(sql: string, params?: unknown[]): Promise<QueryResult> }) => Promise<T>): Promise<T> {
      return fn({ query: (sql, params) => this.query(sql, params) });
    },
  };
}

describe('JobQueue worker heartbeat', () => {
  it('refreshes locked_at only for this worker\'s tracked in-flight jobs', async () => {
    const pool = makeRecordingPool();
    const queue = new JobQueue(pool, { workerId: 'worker-A' });
    const internal = queue as unknown as JobQueueInternals;

    internal.inFlight.add('job-1');
    internal.inFlight.add('job-2');

    await internal._heartbeat();

    const beat = pool.queries.find((q) => /UPDATE street_jobs[\s\S]*SET locked_at = NOW\(\)/.test(q.sql));
    assert.ok(beat, 'Heartbeat should issue an UPDATE that sets locked_at = NOW()');
    assert.match(beat!.sql, /status = 'running'/, 'Should only touch running jobs');
    assert.match(beat!.sql, /worker_id = \$1/, 'Should scope to this worker');
    assert.match(beat!.sql, /id = ANY\(\$2\)/, 'Should target the tracked in-flight ids');

    const params = beat!.params as unknown[];
    assert.equal(params[0], 'worker-A', 'worker_id param should be this worker');
    assert.deepEqual(params[1], ['job-1', 'job-2'], 'Should heartbeat exactly the tracked ids');
  });

  it('issues no query when there are no in-flight jobs', async () => {
    const pool = makeRecordingPool();
    const queue = new JobQueue(pool);
    const internal = queue as unknown as JobQueueInternals;

    await internal._heartbeat();

    assert.equal(pool.queries.length, 0, 'No heartbeat query should run with an empty in-flight set');
  });
});

// ── Tests: Stale-job reaper ───────────────────────────────────────────────────

interface ReapableJob {
  id: string;
  status: string;
  worker_id: string | null;
  locked_at: Date | null;
}

/**
 * A pool that honours the reaper contract: it re-enqueues running jobs whose
 * `locked_at` is older than the threshold encoded in the query params.
 */
function makeReaperPool(jobs: ReapableJob[]): JobQueuePool & {
  jobs: ReapableJob[];
  queries: Array<{ sql: string; params?: unknown[] }>;
} {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    jobs,
    queries,
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      queries.push({ sql, params });
      if (sql.includes('UPDATE street_jobs') && sql.includes("status='pending'") && sql.includes('locked_at <')) {
        const thresholdMs = Number((params ?? [])[0]);
        const cutoff = Date.now() - thresholdMs;
        let reaped = 0;
        for (const j of jobs) {
          if (j.status === 'running' && j.locked_at !== null && j.locked_at.getTime() < cutoff) {
            j.status = 'pending';
            j.worker_id = null;
            j.locked_at = null;
            reaped++;
          }
        }
        return { rows: [], rowCount: reaped, command: 'UPDATE' };
      }
      return { rows: [], rowCount: 0, command: 'UPDATE' };
    },
    async transaction<T>(fn: (conn: { query(sql: string, params?: unknown[]): Promise<QueryResult> }) => Promise<T>): Promise<T> {
      return fn({ query: (sql, params) => this.query(sql, params) });
    },
  };
}

describe('JobQueue stale-job reaper', () => {
  it('re-enqueues running jobs whose lock is older than the threshold, leaving fresh ones alone', async () => {
    const now = Date.now();
    const jobs: ReapableJob[] = [
      { id: 'stale', status: 'running', worker_id: 'dead-worker', locked_at: new Date(now - 3 * 60_000) },
      { id: 'fresh', status: 'running', worker_id: 'live-worker', locked_at: new Date(now - 30_000) },
      { id: 'pending', status: 'pending', worker_id: null, locked_at: null },
    ];
    const pool = makeReaperPool(jobs);
    const queue = new JobQueue(pool); // default 2-minute threshold
    const internal = queue as unknown as JobQueueInternals;

    const reaped = await internal._reapStaleJobs();

    assert.equal(reaped, 1, 'Exactly the stale job should be re-enqueued');

    const stale = jobs.find((j) => j.id === 'stale')!;
    assert.equal(stale.status, 'pending', 'Stale job should be reset to pending');
    assert.equal(stale.worker_id, null, 'Stale job worker_id should be cleared');
    assert.equal(stale.locked_at, null, 'Stale job locked_at should be cleared');

    const fresh = jobs.find((j) => j.id === 'fresh')!;
    assert.equal(fresh.status, 'running', 'A freshly heartbeated job must not be reaped');
    assert.equal(fresh.worker_id, 'live-worker', 'Fresh job ownership should be preserved');
  });

  it('uses the configurable stale threshold in the query params (default 2 minutes)', async () => {
    const poolDefault = makeReaperPool([]);
    const internalDefault = new JobQueue(poolDefault) as unknown as JobQueueInternals;
    await internalDefault._reapStaleJobs();
    const reapDefault = poolDefault.queries.find((q) => q.sql.includes('locked_at <'));
    assert.ok(reapDefault, 'Reaper should issue the stale-job UPDATE');
    assert.deepEqual(reapDefault!.params, ['120000'], 'Default stale threshold should be 2 minutes');

    const poolCustom = makeReaperPool([]);
    const internalCustom = new JobQueue(poolCustom, { staleJobThresholdMs: 45_000 }) as unknown as JobQueueInternals;
    await internalCustom._reapStaleJobs();
    const reapCustom = poolCustom.queries.find((q) => q.sql.includes('locked_at <'));
    assert.deepEqual(reapCustom!.params, ['45000'], 'Custom stale threshold should be honoured');
  });
});

// ── Tests: heartbeat & reaper timer lifecycle ─────────────────────────────────

describe('JobQueue heartbeat/reaper timer lifecycle', () => {
  it('starts heartbeat and reaper timers on start() and clears them on stop()', () => {
    const pool = makeRecordingPool();
    const queue = new JobQueue(pool, { pollIntervalMs: 1_000, heartbeatIntervalMs: 30_000, reaperIntervalMs: 60_000 });
    const timers = queue as unknown as {
      timer: unknown;
      heartbeatTimer: unknown;
      reaperTimer: unknown;
    };

    assert.equal(timers.heartbeatTimer, null, 'Heartbeat timer should be inactive before start');
    assert.equal(timers.reaperTimer, null, 'Reaper timer should be inactive before start');

    queue.start();
    assert.notEqual(timers.heartbeatTimer, null, 'Heartbeat timer should be active after start');
    assert.notEqual(timers.reaperTimer, null, 'Reaper timer should be active after start');

    queue.stop();
    assert.equal(timers.timer, null, 'Poll timer should be cleared after stop');
    assert.equal(timers.heartbeatTimer, null, 'Heartbeat timer should be cleared after stop');
    assert.equal(timers.reaperTimer, null, 'Reaper timer should be cleared after stop');
  });
});
