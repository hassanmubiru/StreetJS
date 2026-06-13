# StreetJS Framework — Background Jobs Example

Demonstrates the StreetJS Framework job processing system: `@Job` decorator, `JobQueue`, `CronScheduler`, and Dead Letter Queue (DLQ) configuration.

## Prerequisites

A running PostgreSQL instance. Configure via environment variables:

```bash
export PG_HOST=localhost
export PG_DATABASE=street_jobs_example
export PG_USER=postgres
export PG_PASSWORD=yourpassword
```

## Quick Start

```bash
npm install
npm run build
npm start
```

## Endpoints

### POST /jobs/email
Enqueue an email delivery job.

```bash
curl -s -X POST http://localhost:3002/jobs/email \
  -H 'Content-Type: application/json' \
  -d '{"to":"user@example.com","subject":"Hello","body":"World"}'
# → {"jobId":"uuid","status":"queued"}
```

### POST /jobs/report
Enqueue a report generation job.

```bash
curl -s -X POST http://localhost:3002/jobs/report \
  -H 'Content-Type: application/json' \
  -d '{"reportType":"weekly-summary","userId":"user-123"}'
# → {"jobId":"uuid","status":"queued"}
```

### GET /jobs/status
Check queue health.

```bash
curl -s http://localhost:3002/jobs/status
# → {"status":"running","message":"Job queue is active"}
```

## Key Concepts

- **`@Job('name')`** — Decorates a class as a job handler for a named job type.
- **`JobQueue`** — Polls the PostgreSQL `street_jobs` table, respects `maxRetries`, and moves permanently failed jobs to the DLQ.
- **`CronScheduler`** — Runs async callbacks on a cron schedule. Schedules are validated at startup (`CronParseError` on invalid expressions).
- **`queue.onDeadLetter()`** — Called when a job exceeds `maxRetries`. Use this to send alerts or archive failed jobs.

## Database Tables Created

| Table | Purpose |
|-------|---------|
| `street_jobs` | Active job queue (pending, running, completed, failed) |
| `street_jobs_dlq` | Dead letter queue for permanently failed jobs |
