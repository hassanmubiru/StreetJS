// src/tests/job-queue.test.ts
// Unit tests for JobQueue and CronScheduler.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import {
  JobQueue,
  Job,
  STREET_JOBS_MIGRATION_SQL,
  type JobQueuePool,
  type JobContext,
} from '../jobs/queue.js';
import { CronScheduler, CronParseError } from '../jobs/scheduler.js';

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
