---
title: Jobs
nav_order: 6
has_children: true
---

# Jobs Guide

Street provides three complementary systems for background work:

| System | Use Case |
|--------|---------|
| `JobQueue` + `@Job` | Durable task queue backed by PostgreSQL, with retries and DLQ |
| `CronScheduler` | Cron expression-based recurring tasks |
| `WorkflowEngine` | Multi-step saga workflows with compensation and distributed locking |

All three systems use the same PostgreSQL pool — no Redis or external broker required.

---

## JobQueue

### Setup

```typescript
import {
  JobQueue, Job,
  STREET_JOBS_MIGRATION_SQL,
  STREET_DLQ_MIGRATION_SQL,
} from '@streetjs/core';

// Run migrations once
await pool.query(STREET_JOBS_MIGRATION_SQL);
await pool.query(STREET_DLQ_MIGRATION_SQL);

const queue = new JobQueue(pool, {
  pollIntervalMs: 1000,   // Poll every second
  concurrency: 5,          // Process up to 5 jobs simultaneously
  maxRetries: 3,           // Retry failed jobs up to 3 times
});
```

### Defining Jobs with @Job

Use the `@Job` decorator to declare a job handler class. The first argument is the **job name** — used to route jobs to the correct handler.

```typescript
import { Job, type JobContext } from '@streetjs/core';

@Job('send-email')
class SendEmailJob {
  async run(data: { to: string; subject: string; body: string }, ctx: JobContext): Promise<void> {
    // ctx.attempt — current attempt number (1-based)
    // ctx.jobId   — unique job ID
    console.log(`Sending email to ${data.to} (attempt ${ctx.attempt})`);
    await sendEmailViaProvider(data.to, data.subject, data.body);
  }
}
```

### Enqueuing Jobs

```typescript
// Enqueue a job to run immediately
await queue.enqueue('send-email', {
  to: 'user@example.com',
  subject: 'Welcome!',
  body: 'Thanks for signing up.',
});

// Enqueue with a delay
await queue.enqueue('send-email', { to: '...' }, {
  runAt: new Date(Date.now() + 60_000),  // Run in 60 seconds
});
```

### Starting the Worker

```typescript
// Register handlers and start polling
queue.register(new SendEmailJob());
await queue.start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await queue.stop();   // Drains in-flight jobs before shutting down
  process.exit(0);
});
```

### DLQ Configuration

Failed jobs that exceed `maxRetries` are moved to the Dead Letter Queue (DLQ). Configure a DLQ handler to alert or archive them:

```typescript
queue.onDeadLetter(async (job) => {
  console.error('Job failed permanently:', job.name, job.data, job.error);
  // Send to Slack, PagerDuty, etc.
});
```

Inspect the DLQ table directly:
```sql
SELECT * FROM street_jobs_dlq ORDER BY failed_at DESC LIMIT 50;
```

---

## CronScheduler

`CronScheduler` runs functions on a schedule defined by standard cron expressions (5-field: `min hour dom month dow`).

```typescript
import { CronScheduler, CronParseError } from '@streetjs/core';

const cron = new CronScheduler();

// Run every hour
cron.schedule('0 * * * *', async () => {
  console.log('Hourly cleanup task running');
  await cleanupExpiredSessions(pool);
});

// Run at midnight on the 1st of every month
cron.schedule('0 0 1 * *', async () => {
  await generateMonthlyReport(pool);
});

// Run every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  await pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY analytics_summary');
});

cron.start();

// Graceful shutdown
process.on('SIGTERM', () => cron.stop());
```

Parsing errors throw `CronParseError` at `schedule()` call time, so misconfigured crons are caught immediately on startup.

---

## WorkflowEngine

`WorkflowEngine` implements the [Saga pattern](https://microservices.io/patterns/data/saga.html) for multi-step processes that need rollback on failure.

### Setup

```typescript
import {
  WorkflowEngine,
  STREET_WORKFLOWS_MIGRATION_SQL,
} from '@streetjs/core';

await pool.query(STREET_WORKFLOWS_MIGRATION_SQL);
const engine = new WorkflowEngine(pool);
```

### Defining a Workflow

```typescript
import { type WorkflowStep, type WorkflowContext } from '@streetjs/core';

engine.define('user-onboarding', [
  {
    name: 'create-account',
    async run(input: { email: string; name: string }, ctx: WorkflowContext) {
      const userId = await createUser(input.email, input.name);
      return { userId };
    },
    async compensate(output: { userId: string }) {
      await deleteUser(output.userId);  // Roll back if a later step fails
    },
  },
  {
    name: 'send-welcome-email',
    async run(input: { userId: string }) {
      await sendWelcomeEmail(input.userId);
      return input;
    },
    timeoutMs: 10_000,  // Step-level timeout
  },
  {
    name: 'provision-workspace',
    async run(input: { userId: string }) {
      const workspaceId = await createWorkspace(input.userId);
      return { userId: input.userId, workspaceId };
    },
    async compensate(output: { workspaceId: string }) {
      await deleteWorkspace(output.workspaceId);
    },
  },
]);
```

### Starting a Workflow

```typescript
const workflowId = await engine.start('user-onboarding', {
  email: 'alice@example.com',
  name: 'Alice',
});

console.log('Workflow started:', workflowId);
```

### Resuming After a Crash

If a process crashes mid-workflow, you can resume from the last completed step:

```typescript
await engine.resume(workflowId);
// Picks up from `current_step` stored in the database
```

### Distributed Locking

`WorkflowEngine.resume()` automatically acquires a PostgreSQL advisory lock (`pg_try_advisory_lock`) keyed to `workflow:<workflowId>` before executing any steps. This prevents two workers from executing the same workflow simultaneously in a multi-instance deployment. The lock is held for up to 30 seconds and released in a `finally` block.

---

## Complete Example

See [`examples/03-background-jobs/`](../../examples/03-background-jobs/) for a fully runnable example combining `JobQueue`, `@Job`, and `CronScheduler`.
