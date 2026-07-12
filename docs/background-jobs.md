---
layout:      default
title:       "Background Jobs in 5 Minutes"
permalink:   /background-jobs/
nav_exclude: true
description:  "Task-oriented guide: run reliable background jobs in StreetJS with the built-in JobQueue — enqueue, process, retry with backoff, dead-letter, and scheduled (cron) jobs, on PostgreSQL."
---

# Background Jobs in 5 Minutes

Goal: take a slow or unreliable piece of work (sending email, calling a flaky
upstream, generating a report) off the request path and run it in the background
— with retries, a dead-letter queue, and crash recovery — using only the
framework's built-in `JobQueue`. No extra broker, no extra dependency.

> **Requirements:** `JobQueue` is backed by **PostgreSQL** (it uses
> `FOR UPDATE SKIP LOCKED` for safe multi-worker dequeue). You need a Postgres
> database and `streetjs >= 1.2.7` (earlier versions mis-encoded `Date`
> parameters such as a job's `run_at` on non-UTC hosts).

## 1. Create the tables

The queue needs three tables. The migration SQL ships with the framework, so you
don't hand-write it — run it once at startup (or from a migration):

```ts
import {
  PgPool,
  STREET_JOBS_MIGRATION_SQL,
  STREET_DLQ_MIGRATION_SQL,
  STREET_JOB_HISTORY_MIGRATION_SQL,
} from 'streetjs';

const pool = new PgPool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

for (const sql of [
  STREET_JOBS_MIGRATION_SQL,
  STREET_DLQ_MIGRATION_SQL,
  STREET_JOB_HISTORY_MIGRATION_SQL,
]) {
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(stmt);
  }
}
```

## 2. Register handlers and start the worker

```ts
import { JobQueue } from 'streetjs';

const queue = new JobQueue(pool, { concurrency: 5, pollIntervalMs: 1000 });

// A handler receives the job payload (and a { jobId, attempt } context).
queue.register('email', async (payload: unknown) => {
  const { to, subject } = payload as { to: string; subject: string };
  await sendEmail(to, subject); // your code
});

// Retry a job type up to N times with exponential backoff before it is
// dead-lettered. Without a policy, a failing job is dead-lettered on first fail.
queue.setRetryPolicy('email', {
  maxAttempts: 5,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 60_000,
});

queue.start(); // begins polling, heartbeating in-flight jobs, and reaping stale ones
```

## 3. Enqueue work from a request handler

```ts
// Inside a controller — return immediately, do the work later.
await queue.enqueue({ type: 'email', payload: { to: user.email, subject: 'Welcome' } });

// Schedule for later with runAt:
await queue.enqueue({
  type: 'email',
  payload: { to: user.email, subject: 'Trial ending' },
  runAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h from now
});
```

That's the whole happy path. A job that keeps failing exhausts its retry policy
and lands in `street_dead_letter_queue` with its last error, so a bad message
never blocks the queue.

## What you get for free

- **At-least-once delivery with SKIP LOCKED** — multiple worker processes can run
  the same queue safely; each job is dequeued by exactly one worker at a time.
- **Crash recovery** — a worker refreshes a heartbeat on its in-flight jobs; if a
  worker dies, a background reaper re-enqueues its stale jobs after a threshold.
- **Retries + dead-letter** — per-type `RetryPolicy` with exponential backoff; a
  job that exhausts its attempts is moved to the DLQ, not lost.
- **Bounded growth** — `pruneDeadLetterQueue(max)` and `pruneJobHistory(maxPerType)`,
  or register them as nightly cron jobs (see below).

## Scheduled (cron) jobs

Use `CronScheduler` for recurring work. It parses standard 5-field cron
expressions and guards against overlapping runs of the same job:

```ts
import { CronScheduler } from 'streetjs';

const scheduler = new CronScheduler();

// Nightly cleanup at 00:00.
scheduler.register('0 0 * * *', 'nightly-cleanup', async () => {
  await queue.pruneJobHistory(1000);
  await queue.pruneDeadLetterQueue(500);
});

scheduler.start();
```

> **Cron semantics note:** day-of-month and weekday are matched with **AND**
> (both must match), not the POSIX/Vixie **OR** convention. For a job that should
> run on the 1st *or* on Mondays, register two entries.

## Observing the queue

`queue.metrics()` returns a point-in-time snapshot (`pending`, `inFlight`,
`failed`, `succeeded`, and per-type average duration). To expose it over HTTP for
dashboards, wire the job-metrics route:

```ts
import { registerJobMetricsRoute } from 'streetjs';
registerJobMetricsRoute(app, queue); // GET /api/jobs/metrics
```

Combine with the app's Prometheus `/metrics` endpoint (scaffolded by default) for
end-to-end visibility.

## Graceful shutdown

```ts
process.once('SIGTERM', async () => {
  queue.stop();       // stop polling/heartbeat/reaper
  scheduler.stop();
  await pool.close();
});
```

---

*Every snippet here reflects the real `JobQueue` / `CronScheduler` API and was
exercised end-to-end (enqueue → process → retry → dead-letter, and a live cron
fire) against a PostgreSQL database.*
