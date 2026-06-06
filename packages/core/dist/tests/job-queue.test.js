// src/tests/job-queue.test.ts
// Unit tests for JobQueue and CronScheduler.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { JobQueue, Job, STREET_JOBS_MIGRATION_SQL, STREET_DLQ_MIGRATION_SQL, } from '../jobs/queue.js';
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
        assert.match(STREET_JOBS_MIGRATION_SQL, /CREATE INDEX[\s\S]*street_jobs\s*\(status,\s*run_at\)/i, 'Should create an index on (status, run_at)');
    });
    it('STREET_JOBS_MIGRATION_SQL is idempotent (uses IF NOT EXISTS)', () => {
        assert.match(STREET_JOBS_MIGRATION_SQL, /CREATE TABLE IF NOT EXISTS/i);
        assert.match(STREET_JOBS_MIGRATION_SQL, /CREATE INDEX IF NOT EXISTS/i);
    });
    it('STREET_DLQ_MIGRATION_SQL creates the street_dead_letter_queue table with all required columns', () => {
        assert.ok(STREET_DLQ_MIGRATION_SQL.includes('street_dead_letter_queue'), 'Should reference street_dead_letter_queue table');
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
/** Build a simple mock pool that records calls and returns configured responses. */
function makeMockPool(opts = {}) {
    const queries = [];
    return {
        queries,
        async query(sql, params) {
            queries.push({ sql, params });
            if (sql.includes('INSERT INTO street_jobs') && sql.includes('RETURNING id')) {
                return { rows: [{ id: opts.enqueueId ?? 'test-uuid-1' }], rowCount: 1, command: 'INSERT' };
            }
            if (sql.includes('SELECT') && sql.includes('FOR UPDATE SKIP LOCKED')) {
                return {
                    rows: (opts.jobRows ?? []),
                    rowCount: opts.jobRows?.length ?? 0,
                    command: 'SELECT',
                };
            }
            if (sql.includes('DELETE FROM street_jobs') || sql.includes('UPDATE street_jobs')) {
                return { rows: [], rowCount: 1, command: 'UPDATE' };
            }
            return { rows: [], rowCount: 0, command: 'SELECT' };
        },
        async transaction(fn) {
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
        const params = insertQuery.params;
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
        const params = insertQuery.params;
        // Third param is run_at
        assert.deepEqual(params[2], futureDate);
    });
});
// ── Tests: JobQueue execution (polling) ───────────────────────────────────────
describe('JobQueue handler execution', () => {
    it('dispatches a job to the registered handler', async () => {
        const executedPayloads = [];
        const jobRow = {
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
        const jobRow = {
            id: 'job-del',
            type: 'del-job',
            payload: '{}',
            attempt_count: '0',
        };
        const pool = makeMockPool({ jobRows: [jobRow] });
        const queue = new JobQueue(pool, { pollIntervalMs: 50 });
        queue.register('del-job', async () => { });
        queue.start();
        await new Promise((res) => setTimeout(res, 100));
        queue.stop();
        const deleteQuery = pool.queries.find((q) => q.sql.includes('DELETE FROM street_jobs') && q.params[0] === 'job-del');
        assert.ok(deleteQuery, 'Expected DELETE query for completed job');
    });
});
// ── Tests: @Job decorator and registerClass ───────────────────────────────────
describe('@Job decorator and registerClass', () => {
    it('registers a class decorated with @Job', async () => {
        const executed = [];
        let MyJob = class MyJob {
            async execute(payload, ctx) {
                executed.push({ payload, ctx });
            }
        };
        MyJob = __decorate([
            Job('decorated-job')
        ], MyJob);
        const jobRow = {
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
            async execute(_payload, _ctx) { }
        }
        const pool = makeMockPool();
        const queue = new JobQueue(pool);
        assert.throws(() => queue.registerClass(PlainClass), (err) => {
            assert.ok(err instanceof Error);
            assert.ok(err.message.includes('not decorated with @Job'));
            return true;
        });
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
        const params = insert.params;
        assert.deepEqual(params[2], runAt, 'run_at param should equal the provided date');
    });
});
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
function makeStatefulPool() {
    const jobs = new Map();
    let seq = 0;
    const pool = {
        jobs,
        async query(sql, params) {
            const args = (params ?? []);
            if (sql.includes('INSERT INTO street_jobs') && sql.includes('RETURNING id')) {
                const id = `job-${++seq}`;
                const type = args[0];
                const payload = args[1];
                const runAt = args[2];
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
            if (sql.includes('FOR UPDATE SKIP LOCKED')) {
                const now = Date.now();
                const limit = args[0] ?? 100;
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
                return { rows: ready, rowCount: ready.length, command: 'SELECT' };
            }
            if (sql.includes("UPDATE street_jobs SET status='running'")) {
                const id = args[1];
                const job = jobs.get(id);
                if (job) {
                    job.status = 'running';
                    job.worker_id = args[0];
                    job.locked_at = new Date();
                }
                return { rows: [], rowCount: 1, command: 'UPDATE' };
            }
            if (sql.includes('DELETE FROM street_jobs')) {
                const id = args[0];
                jobs.delete(id);
                return { rows: [], rowCount: 1, command: 'DELETE' };
            }
            if (sql.includes("UPDATE street_jobs") && sql.includes("status='pending'")) {
                // retry re-scheduling: mirror `run_at = NOW() + ($delay || ' milliseconds')::interval`
                const id = args[3];
                const job = jobs.get(id);
                if (job) {
                    job.status = 'pending';
                    job.attempt_count = args[0];
                    job.error = args[1];
                    const delayMs = Number(args[2]);
                    job.run_at = new Date(Date.now() + delayMs);
                    job.worker_id = null;
                    job.locked_at = null;
                }
                return { rows: [], rowCount: 1, command: 'UPDATE' };
            }
            return { rows: [], rowCount: 0, command: 'SELECT' };
        },
        async transaction(fn) {
            return fn({ query: (sql, params) => pool.query(sql, params) });
        },
    };
    return pool;
}
/** Drain pending microtasks (the async poll/dispatch chain) after advancing timers. */
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));
/**
 * Advance mock timers in `stepMs` increments, draining the async work between
 * each tick so each poll completes (and deletes its job) before the next fires.
 * This mirrors real sequential polling and avoids artificial double-dispatch.
 */
async function advancePolls(timers, totalMs, stepMs) {
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
        const executed = [];
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
        const ran = [];
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
        const fires = [];
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
        assert.throws(() => sched.register('* * * *', 'bad', async () => { }), (err) => {
            assert.ok(err instanceof CronParseError);
            assert.match(err.message, /expected 5 fields/);
            return true;
        });
    });
    it('throws CronParseError for out-of-range minute', () => {
        const sched = new CronScheduler();
        assert.throws(() => sched.register('60 * * * *', 'bad-min', async () => { }), (err) => {
            assert.ok(err instanceof CronParseError);
            return true;
        });
    });
    it('throws CronParseError for out-of-range hour', () => {
        const sched = new CronScheduler();
        assert.throws(() => sched.register('0 24 * * *', 'bad-hour', async () => { }), (err) => {
            assert.ok(err instanceof CronParseError);
            return true;
        });
    });
    it('throws CronParseError for non-numeric value', () => {
        const sched = new CronScheduler();
        assert.throws(() => sched.register('abc * * * *', 'bad-val', async () => { }), (err) => {
            assert.ok(err instanceof CronParseError);
            return true;
        });
    });
    it('accepts a valid expression without throwing', () => {
        const sched = new CronScheduler();
        assert.doesNotThrow(() => sched.register('0 0 * * *', 'daily', async () => { }));
        assert.doesNotThrow(() => sched.register('*/15 * * * *', 'every-15m', async () => { }));
        assert.doesNotThrow(() => sched.register('0 9-17 * * 1-5', 'weekday-hours', async () => { }));
    });
});
describe('CronScheduler single-instance guard', () => {
    it('skips a second invocation while the same job is still running (real _fire guard)', async () => {
        const sched = new CronScheduler();
        let calls = 0;
        let active = 0;
        let maxConcurrent = 0;
        let release;
        const gate = new Promise((res) => {
            release = res;
        });
        sched.register('* * * * *', 'slow', async () => {
            calls++;
            active++;
            if (active > maxConcurrent)
                maxConcurrent = active;
            await gate; // hold the job "running" until we release it
            active--;
        });
        const internal = sched;
        internal.started = true; // _fire returns early unless started
        const entry = internal.jobs.get('slow');
        assert.ok(entry, 'Expected the registered entry to exist');
        // First fire begins execution and suspends on the gate while running.
        const p1 = internal._fire(entry);
        assert.equal(calls, 1, 'First fire should invoke the job exactly once');
        assert.equal(entry.running, true, 'Entry should be flagged as running');
        // Second fire while still running must be skipped by the guard.
        const p2 = internal._fire(entry);
        assert.equal(calls, 1, 'Guard must prevent a second concurrent invocation');
        assert.equal(maxConcurrent, 1, 'At most one instance may run at a time');
        // Release the first invocation and let both settle.
        release();
        await Promise.all([p1, p2]);
        assert.equal(calls, 1, 'No additional invocation should have occurred after completion');
        assert.equal(maxConcurrent, 1, 'Concurrency never exceeded one');
        assert.equal(entry.running, false, 'Entry should no longer be running');
        sched.stop();
    });
});
// ── Tests: Retry policy backoff formula ──────────────────────────────────────
describe('RetryPolicy backoff formula', () => {
    it('computes delay as Math.min(initialDelay * multiplier^attempt, maxDelay)', () => {
        // Verify the formula directly
        const policy = { maxAttempts: 5, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 10_000 };
        const delays = [0, 1, 2, 3].map((attempt) => Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt), policy.maxDelayMs));
        assert.equal(delays[0], 1000); // 1000 * 2^0 = 1000
        assert.equal(delays[1], 2000); // 1000 * 2^1 = 2000
        assert.equal(delays[2], 4000); // 1000 * 2^2 = 4000
        assert.equal(delays[3], 8000); // 1000 * 2^3 = 8000
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
        assert.doesNotThrow(() => queue.setRetryPolicy('send-email', {
            maxAttempts: 5,
            initialDelayMs: 1000,
            backoffMultiplier: 2,
            maxDelayMs: 30_000,
        }));
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
        assert.equal(job.status, 'pending', 'Failing job should be re-scheduled as pending');
        assert.equal(job.attempt_count, 1, 'attempt_count should be incremented after a failed attempt');
        assert.equal(job.error, 'boom', 'Failure error should be recorded');
    });
    it('uses per-type policies independently — each type retains its own config', () => {
        const pool = makeMockPool();
        const queue = new JobQueue(pool);
        queue.setRetryPolicy('a', { maxAttempts: 2, initialDelayMs: 100, backoffMultiplier: 2, maxDelayMs: 1000 });
        queue.setRetryPolicy('b', { maxAttempts: 7, initialDelayMs: 250, backoffMultiplier: 3, maxDelayMs: 9000 });
        // Inspect the internal per-type map to confirm isolation between types.
        const policies = queue.retryPolicies;
        assert.equal(policies.get('a').maxAttempts, 2);
        assert.equal(policies.get('b').maxAttempts, 7);
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
        assert.equal(after1.attempt_count, 1, 'attempt_count should increment to 1');
        assert.equal(after1.status, 'pending', 'Job should be rescheduled as pending');
        assert.equal(after1.worker_id, null, 'worker_id must be cleared on reschedule');
        assert.equal(after1.locked_at, null, 'locked_at must be cleared on reschedule');
        const expectedDelay1 = Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, 0), policy.maxDelayMs);
        assert.equal(after1.run_at.getTime(), Date.now() + expectedDelay1, 'run_at should be NOW() + 1000ms after the first failure');
        // Advance to when the retry becomes due (1000ms later) for the second failure.
        // attempt 1 -> delay = 1000 * 2^1 = 2000ms.
        await advancePolls(t.mock.timers, 1_000, 100);
        const after2 = pool.jobs.get(id);
        assert.ok(after2, 'Job should still be retained after the second failure');
        assert.equal(after2.attempt_count, 2, 'attempt_count should increment to 2');
        const expectedDelay2 = Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, 1), policy.maxDelayMs);
        assert.equal(after2.run_at.getTime(), Date.now() + expectedDelay2, 'run_at should be NOW() + 2000ms after the second failure');
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
        assert.equal(job.run_at.getTime(), Date.now() + policy.maxDelayMs, 'run_at delay should be capped at maxDelayMs');
    });
});
//# sourceMappingURL=job-queue.test.js.map