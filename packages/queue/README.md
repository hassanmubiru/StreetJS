# @streetjs/queue

Strongly-typed, plugin-first **background jobs and queues** for StreetJS. It gives
you an ergonomic dispatch API, delayed and cron scheduling, retry/backoff, a
dead-letter queue, worker concurrency and priority, per-queue rate limiting, a
composable middleware pipeline, typed lifecycle events, health and metrics, a
CLI, and a Redis-free testing harness — all layered over a **pluggable driver
contract** with interchangeable **Memory** (default, zero third-party runtime
dependencies) and **Redis** (opt-in) drivers.

- **Additive.** `@streetjs/queue` is a standalone package that declares
  `streetjs` as a dependency. It makes no changes to the core.
- **Zero-dep by default.** The Memory driver pulls in no third-party runtime
  dependencies. The Redis driver ships behind the opt-in `@streetjs/queue/redis`
  submodule.
- **At-least-once delivery.** Delivery is honestly at-least-once (not
  exactly-once). See [Delivery semantics and idempotency](#delivery-semantics-and-idempotency).

## Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Delayed Jobs](#delayed-jobs)
- [Scheduling](#scheduling)
- [Retry Policies](#retry-policies)
- [Failed Jobs](#failed-jobs)
- [Queues with Redis](#queues-with-redis)
- [Queues with Memory](#queues-with-memory)
- [Monitoring](#monitoring)
- [Scaling Workers](#scaling-workers)
- [Testing Jobs](#testing-jobs)
- [Delivery semantics and idempotency](#delivery-semantics-and-idempotency)
- [Multi-instance cron and the distributed lock](#multi-instance-cron-and-the-distributed-lock)

## Install

```bash
npm install @streetjs/queue streetjs
```

The package is ESM (`"type": "module"`) and ships type declarations. Using the
default Memory driver requires no other runtime dependency.

## Quick Start

Define a typed job, register a handler, dispatch a job, and start a worker.

```ts
import { createQueue, Job } from '@streetjs/queue';

// 1. Define a strongly-typed job. `type` routes it to a handler.
class SendEmailJob extends Job<{ to: string; subject: string }> {
  readonly type = 'send-email';
}

// 2. Create a queue (defaults to the in-process Memory driver).
const queue = createQueue();

// 3. Register the handler for the job type.
queue.register<{ to: string; subject: string }>('send-email', async (payload, ctx) => {
  console.log(`sending to ${payload.to} (attempt ${ctx.attempt}/${ctx.maxAttempts})`);
  // ...send the email...
});

// 4. Dispatch a job. Returns the assigned job id.
const jobId = await queue.dispatch(new SendEmailJob({ to: 'a@b.com', subject: 'Hi' }));

// 5. Start a worker to process the "default" queue.
const worker = queue.work();
worker.start();

// ...later, on shutdown:
await queue.close(); // stops workers/scheduler, drains in-flight, closes the driver
```

`queue.work(options?)` builds a `Worker` but does **not** start it — call
`worker.start()` to begin the reservation loop (it is idempotent). `close()`
gracefully stops reserving new jobs, awaits in-flight completion, and closes the
driver.

You can also register a handler by the job class, which derives the `type` from
a fresh instance:

```ts
queue.registerClass(SendEmailJob, async (payload, ctx) => { /* ... */ });
```

## Delayed Jobs

Defer a job with a `delay` (milliseconds or a human duration string parsed by the
core `parseWindow`) or an absolute `runAt` date. A delayed job never becomes
eligible for reservation before its due time.

```ts
// Run in 5 minutes (human string) ...
await queue.dispatch(new SendEmailJob({ to: 'a@b.com', subject: 'Later' }), {
  delay: '5m',
});

// ... or in 30 seconds (milliseconds) ...
await queue.dispatch(new SendEmailJob({ to: 'a@b.com', subject: 'Soon' }), {
  delay: 30_000,
});

// ... or at an absolute time.
await queue.dispatch(new SendEmailJob({ to: 'a@b.com', subject: 'At 9am' }), {
  runAt: new Date('2025-01-01T09:00:00Z'),
});
```

A running worker starts the scheduler's promotion loop, which moves delayed jobs
into their ready queue once their due time arrives.

## Scheduling

Register a recurring job by cron expression with `queue.schedule(cron, JobClass)`.
The scheduled job class must be constructable with no arguments; a fresh
instance is dispatched on every fire.

```ts
import { createQueue, Job, CronParseError } from '@streetjs/queue';

class CleanupJob extends Job<void> {
  readonly type = 'cleanup';
  constructor() {
    super(undefined);
  }
}

const queue = createQueue();
queue.register('cleanup', async () => { /* ...housekeeping... */ });

// Fire every hour on the minute.
queue.schedule('0 * * * *', CleanupJob);

const worker = queue.work();
worker.start();
```

A malformed cron expression throws `CronParseError` **synchronously** at
registration (nothing is partially registered), so you can catch it directly:

```ts
try {
  queue.schedule('not a cron', CleanupJob);
} catch (err) {
  if (err instanceof CronParseError) {
    // handle the bad expression
  }
}
```

You may also schedule an existing instance: `queue.schedule('0 * * * *', new CleanupJob())`.

## Retry Policies

Control the attempt ceiling with `maxAttempts` (total attempts, initial +
retries) or the convenience alias `retries` (`maxAttempts = retries + 1`).

- When only `maxAttempts` is set, the ceiling is `maxAttempts`.
- When `retries` is set, the ceiling is `retries + 1` and any `maxAttempts` is
  ignored (even when both are provided).
- When neither is set, the ceiling defaults to `1` (no retry).

Configure the delay between attempts with a `backoff` policy. The `exponential`
strategy computes `min(base * multiplier^(attempt - 1), maxDelay)`; the `fixed`
strategy uses a constant delay. `delay` and `maxDelay` accept milliseconds or a
human duration string. An optional `jitter` fraction in `[0, 1]` randomizes the
computed delay (a jitter of `0` yields exactly the computed delay).

```ts
await queue.dispatch(new SendEmailJob({ to: 'a@b.com', subject: 'Retryable' }), {
  retries: 5, // 6 total attempts
  backoff: {
    strategy: 'exponential',
    delay: '1s',       // base delay
    multiplier: 2,     // must be >= 1
    maxDelay: '30s',   // upper bound on any single delay
    jitter: 0.1,       // +/- 10% randomization
  },
  timeout: '10s',      // per-attempt timeout; fires the AbortSignal and counts as a failure
});
```

A fixed policy:

```ts
backoff: { strategy: 'fixed', delay: '5s' }
```

You can also set a queue-wide default via `QueueOptions.defaultBackoff` and a
default per-attempt timeout via `QueueOptions.defaultTimeout`. When a job
execution exceeds its per-attempt `timeout`, the execution `AbortSignal` fires
and the attempt is treated as a failure routed through the retry engine.

## Failed Jobs

When a job exhausts its attempts (or has no registered handler), it is moved to
the **dead-letter queue** exactly once. Inspect and replay dead letters through
`queue.deadLetters`:

```ts
// List dead-letter records (optionally scoped to a queue, with a limit).
const records = await queue.deadLetters.list();
for (const r of records) {
  console.log(r.id, r.type, r.queue, r.attempts, r.error.name, r.error.message);
}

// Re-enqueue a single record (attempts reset to 0, eligible for a full budget again).
await queue.deadLetters.retry(records[0].id);

// Re-enqueue every dead-letter record (optionally scoped to a queue). Returns the count.
const reEnqueued = await queue.deadLetters.retryAll();

// Purge dead-letter records without re-enqueuing. Returns the count removed.
const purged = await queue.deadLetters.flush();
```

Each `DeadLetterRecord` carries the job `id`, `type`, `queue`, `payload`,
consumed `attempts`, `maxAttempts`, the serialized `error`, and the `enqueuedAt`
/ `failedAt` timestamps.

The same operations are available from the CLI (registered through the core
`CliKernel`):

```bash
street queue:failed              # list dead-letter records
street queue:failed --queue emails
street queue:retry <jobId>       # re-enqueue one record with attempts reset
street queue:retry               # re-enqueue all (optionally --queue <name>)
street queue:flush               # purge dead-letter records (optionally --queue <name>)
```

## Queues with Redis

The Redis driver is durable and multi-worker. It is opt-in: import it from the
`@streetjs/queue/redis` submodule and construct it with a core `RedisClient`
(or any compatible client), then pass it as the `driver`.

```ts
import { createQueue } from '@streetjs/queue';
import { RedisDriver } from '@streetjs/queue/redis';
import { RedisClient } from 'streetjs';

const client = new RedisClient({ host: '127.0.0.1', port: 6379 });
const driver = new RedisDriver({ client, keyPrefix: 'streetjs:queue' });

const queue = createQueue({ driver });

const worker = queue.work();
worker.start();
```

`RedisDriverOptions` accepts:

- `client` — the core `RedisClient` (or a `RedisClientLike`: `connect`,
  `command`, `publish`, `subscribe`, `close`).
- `keyPrefix` — namespaces all keys. Default `"streetjs:queue"`.
- `visibilityMs` — the reservation visibility lease before crash-reclaim.
  Default `30000`.

The driver uses poll plus pub/sub wake-ups (there is no blocking pop in the core
client), so correctness never depends on a pub/sub message arriving. Its `init`
rejects if the backend is unreachable, and the queue surfaces that error rather
than silently falling back to Memory. On connection loss the driver's health
reports `down` (see [Monitoring](#monitoring)).

Because the Redis driver is reached only through the `@streetjs/queue/redis`
submodule, Memory-driver users pull in zero extra runtime dependencies.

## Queues with Memory

The **Memory driver** is the default. It is a zero-dependency, in-process driver
that keeps ready jobs in a priority order (FIFO on ties), delayed jobs by due
time, reservations under a visibility lease, and a per-queue dead-letter list.
It is ideal for single-process apps, tests, and getting started.

```ts
import { createQueue } from '@streetjs/queue';

// No driver configured -> a MemoryDriver is used automatically.
const queue = createQueue();

// Equivalent, explicit form:
import { MemoryDriver } from '@streetjs/queue';
const queue2 = createQueue({ driver: new MemoryDriver() });
```

The Memory driver always reports its health as `up`.

## Monitoring

Queue health and metrics wire into the existing core `HealthCheckRegistry` and
`MetricsRegistry`. The wiring is performed by `QueuePlugin`, which reads the
registries from its options and registers the health check and metrics on load.

```ts
import { QueuePlugin } from '@streetjs/queue';
import { HealthCheckRegistry, MetricsRegistry } from 'streetjs';

const health = new HealthCheckRegistry();
const metrics = new MetricsRegistry();

const plugin = new QueuePlugin({ health, metrics });
await plugin.onLoad(app);   // registers the "queue" health check + metrics
const queue = plugin.queue; // the constructed Queue facade

// ...on shutdown:
await plugin.onUnload(app); // stops the observability refresh and closes the queue
```

- **Health check.** Registered under the name `queue`. It maps the active
  driver's connectivity onto a `CheckResult` and attaches worker liveness to the
  details. The Memory driver is always `up`; the Redis driver reports `down` on
  connection loss and stays `up` while connected even if an individual command
  fails with an auth error or timeout. The Memory driver is unaffected by a
  Redis outage.
- **Metrics.** Exported through the core `MetricsRegistry`:

  | Metric | Type | Description |
  | --- | --- | --- |
  | `queue_length` | Gauge | Jobs by state, labelled `queue` and `state` (`ready`/`delayed`/`reserved`/`dead_lettered`) |
  | `queue_worker_status` | Gauge | Worker fields, labelled `field` (`running`/`concurrency`/`in_flight`/`processed`/`failed`) |
  | `queue_job_latency_seconds` | Histogram | Job execution latency in seconds |
  | `queue_processed_total` | Counter | Jobs processed successfully |
  | `queue_failures_total` | Counter | Jobs that failed terminally (dead-lettered) |

Metric reads are best-effort and never throw: a snapshot sources live counts
from the active driver and worker and returns what it can.

## Scaling Workers

Tune a worker through `WorkerOptions`:

- `queues` — which queues to consume, in priority order left-to-right. Default
  `["default"]`.
- `concurrency` — the maximum number of jobs processed simultaneously. Default
  `1`. The worker never exceeds this bound and defers reserving while it is
  saturated.
- `pollIntervalMs` — poll interval used as a fallback when the driver has no push
  wake-up. Default `1000`.
- `stopWhenEmpty` — stop once the queue drains (handy for one-shot runs/tests).
- `visibilityMs` — the reservation visibility lease. Default `30000`.

```ts
// One worker, 10 jobs at a time, consuming two queues in priority order.
const worker = queue.work({ queues: ['critical', 'default'], concurrency: 10 });
worker.start();
```

**Job priority.** Dispatch with a `priority` (higher runs first; default `0`).
Jobs of equal priority run in FIFO order by enqueue sequence.

```ts
await queue.dispatch(new SendEmailJob({ to: 'a@b.com', subject: 'Urgent' }), {
  queue: 'critical',
  priority: 10,
});
```

**Multiple queues.** Run several workers, or a single worker across several
queues; the worker reserves from the highest-priority non-empty queue in the
configured order.

**Per-queue rate limits.** Cap how fast a queue is drained. A job that would
exceed the quota is deferred (nacked to a later time), never dropped, and is
processed automatically once the window admits it.

```ts
const queue = createQueue({
  rateLimits: {
    emails: { requests: 100, window: '1m' }, // at most 100 email jobs started per minute
  },
});
```

Live status is available via `worker.status()` (`running`, `concurrency`,
`inFlight`, `processed`, `failed`, `queues`).

## Testing Jobs

The package ships a Redis-free testing harness so you can unit test jobs and
workers with no real Redis and no wall-clock timing.

- **`FakeQueue`** — records every `dispatch`/`schedule` call and every emitted
  event, and drives execution synchronously via `runNext()` / `runAll()`. Assert
  *that* a job was dispatched (and with which options) without any scheduling.
- **`MemoryQueue`** — a real `Queue` over the Memory driver with a real worker,
  for end-to-end behavior without Redis.
- **`TestHarness`** — builds a `Queue` with an **injected, advanceable clock**
  and helpers to `enqueue`, `advance(ms)` (advances the clock and runs delayed
  promotion and rate windows), `reserveAll`, `run`/`runReady`, `failNext`, and
  `assertEvents`.

```ts
import { FakeQueue, MemoryQueue, TestHarness } from '@streetjs/queue';
import { Job } from '@streetjs/queue';

class SendEmailJob extends Job<{ to: string }> {
  readonly type = 'send-email';
}

// FakeQueue: assert dispatch + drive synchronously.
const fake = new FakeQueue();
fake.register('send-email', async () => { /* ... */ });
await fake.dispatch(new SendEmailJob({ to: 'a@b.com' }));
console.log(fake.dispatched.length); // 1
await fake.runAll();                 // runs the handler synchronously

// TestHarness: deterministic clock, no timers, no Redis.
const harness = new TestHarness();
harness.register('send-email', async () => { /* ... */ });
await harness.enqueue(new SendEmailJob({ to: 'a@b.com' }), { delay: '5m' });
await harness.advance(5 * 60_000);   // promote due jobs
await harness.runReady();            // reserve + execute ready jobs
harness.assertEvents(['job.started', 'job.completed']);

// MemoryQueue: full end-to-end path with a real worker.
const mq = new MemoryQueue();
mq.register('send-email', async () => { /* ... */ });
await mq.dispatch(new SendEmailJob({ to: 'a@b.com' }));
const worker = mq.work({ stopWhenEmpty: true });
worker.start();
```

> Note: the testing helpers (`FakeQueue`, `MemoryQueue`, `TestHarness`) are part
> of the `@streetjs/queue` package's testing module.

## Delivery semantics and idempotency

`@streetjs/queue` provides **at-least-once** delivery. It does **not** provide
exactly-once delivery, and it never claims to. A job is delivered to a handler at
least once and executed to a successful ack no more than `maxAttempts` times; a
successful job is acked exactly once and not re-delivered. But because a worker
can crash after running a handler and before acking (letting its visibility lease
expire), the same job may be delivered again. **Design your handlers to be
idempotent.**

Two independent strategies for idempotency — use **either one alone**, you do not
need both:

1. **Deduplicate on the job id alone.** Every dispatched job has a stable, unique
   `id` (returned by `dispatch` and available as `ctx.id` in the handler). Record
   the id of work you have completed and skip it if you see the same id again.

   ```ts
   queue.register('send-email', async (payload, ctx) => {
     if (await alreadyProcessed(ctx.id)) return; // idempotent on job id
     await sendEmail(payload);
     await markProcessed(ctx.id);
   });
   ```

2. **Deduplicate on the `dedupeKey` alone.** Provide a `dedupeKey` at dispatch to
   collapse duplicate *dispatches*: while a job with a given key is still pending
   or ready in the same queue, a second dispatch with the same key is dropped (no
   second envelope is enqueued) and the existing job id is returned.

   ```ts
   await queue.dispatch(new SendEmailJob({ to: 'a@b.com', subject: 'Welcome' }), {
     dedupeKey: 'welcome:a@b.com',
   });
   ```

   Note that `dedupeKey` drops a duplicate only while the first job is still
   pending or ready. Once the first job has been reserved and completes (or is
   dead-lettered), the key is released and a fresh dispatch with the same key is
   admitted again. `dedupeKey` therefore prevents duplicate *enqueues*, not
   duplicate *deliveries* of an already-running job — for the latter, deduplicate
   on the job id in your handler.

Choose the job id when you want to guard against re-delivery of an in-flight or
retried job inside your handler; choose the `dedupeKey` when you want to collapse
repeated dispatches of the same logical work before it runs.

## Multi-instance cron and the distributed lock

On a single instance, the scheduler relies on the core cron scheduler's
re-entrancy guard to prevent overlapping fires. Across **multiple instances**,
scheduled dispatch fires **once per running instance per tick** by default —
every instance runs its own scheduler.

To fire **exactly once per tick** across instances, configure the optional
distributed lock via `QueueOptions.scheduleLock`. Each cron fire is then guarded
by a per-tick lock keyed by the schedule and the fire minute, so exactly one
instance dispatches per tick.

```ts
import { createQueue } from '@streetjs/queue';
import type { SchedulerLock } from '@streetjs/queue';

const lock: SchedulerLock = {
  async tryAcquire(key, ttlMs) {
    // Return a { release } handle if this instance won the tick, or null if
    // another instance already holds it. Back this with the core DistributedLock
    // (or any equivalent backend lock).
    return acquired ? { release: async () => { /* ... */ } } : null;
  },
};

const queue = createQueue({ scheduleLock: lock });
```

Without a `scheduleLock`, expect one fire per instance per tick. With it, expect
exactly one fire per tick across the whole fleet.
