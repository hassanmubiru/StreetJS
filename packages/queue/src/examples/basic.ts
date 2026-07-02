// src/examples/basic.ts
// @streetjs/queue — a runnable, self-contained example (Req 17.4).
//
// This single program demonstrates the full happy path of the queue framework
// over the zero-dependency in-process `MemoryDriver` (no Redis required):
//
//   (a) dispatch + a worker processing a job,
//   (b) a delayed job that only runs once its Due_Time arrives,
//   (c) a cron-scheduled job registered through the scheduling API,
//   (d) dead-letter handling — a job that always fails, exhausts its attempts,
//       and is inspected through `queue.deadLetters.list()`.
//
// It is written to run FAST and DETERMINISTICALLY: the scheduler promotes
// delayed/retried jobs on a short tick, backoff is a small fixed delay, and the
// program exits cleanly via `queue.close()` so no timers leak. The same
// `main()` is executed by `src/tests/example-smoke.test.ts` so the example stays
// working.
//
// Run it directly after a build:  `npm run build && npm run example`
//
// Import note: inside this package `@streetjs/queue` does not resolve to itself
// (no self-referential paths mapping), so the example imports from the local
// package entry `../index.js`. When compiled by `tsc` this resolves to
// `dist/index.js` — the exact module external consumers import as
// `@streetjs/queue`.

import { createQueue, Job } from '../index.js';
import type { Queue } from '../index.js';

// ── Job definitions ─────────────────────────────────────────────────────────

/** A trivial job processed immediately by the worker. */
class WelcomeEmailJob extends Job<{ to: string }> {
  readonly type = 'email.welcome';
}

/** A job dispatched with a delay so it only runs after its Due_Time. */
class ReminderJob extends Job<{ userId: string }> {
  readonly type = 'reminder.send';
}

/** A job registered on a cron schedule to demonstrate the scheduling API. */
class NightlyReportJob extends Job<{ report: string }> {
  readonly type = 'report.nightly';
  constructor() {
    super({ report: 'daily-summary' });
  }
}

/** A job that always throws, so it exhausts its attempts and is dead-lettered. */
class FlakyJob extends Job<{ id: number }> {
  readonly type = 'flaky.process';
}

/** The outcome the example reports (and the smoke test asserts against). */
export interface ExampleResult {
  /** Payloads of welcome emails the worker processed. */
  readonly processedEmails: string[];
  /** True once the delayed reminder ran (proves delayed promotion works). */
  readonly reminderRan: boolean;
  /** Epoch ms the delayed reminder actually ran at, if it ran. */
  readonly reminderRanAt?: number;
  /** Epoch ms the delayed reminder was dispatched at. */
  readonly reminderDispatchedAt: number;
  /** The delay (ms) requested for the reminder. */
  readonly reminderDelayMs: number;
  /** How many times the always-failing job was attempted. */
  readonly flakyAttempts: number;
  /** The job ids that landed in the dead-letter queue. */
  readonly deadLetteredIds: string[];
  /** The error message recorded for the dead-lettered flaky job. */
  readonly deadLetterError?: string;
  /** True while the cron schedule was registered without error. */
  readonly cronRegistered: boolean;
}

/** Small helper: resolve once `predicate` holds, or reject after `timeoutMs`. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('example waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Log helper that stays quiet while running under the smoke test. */
function log(quiet: boolean, ...args: unknown[]): void {
  if (!quiet) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

/**
 * Run the end-to-end demonstration and return a structured {@link ExampleResult}.
 *
 * @param quiet When true, suppresses console output (used by the smoke test).
 */
export async function main(quiet = false): Promise<ExampleResult> {
  // A MemoryDriver-backed queue (the default) so this runs anywhere with no
  // Redis. A short scheduler tick promotes delayed/retried jobs quickly so the
  // example finishes in well under a second.
  const queue: Queue = createQueue({ schedulerTickIntervalMs: 10 });

  // ── State captured by the handlers so we can report the outcome ─────────────
  const processedEmails: string[] = [];
  let reminderRan = false;
  let reminderRanAt: number | undefined;
  let flakyAttempts = 0;

  // (a) A normal job: send a welcome email.
  queue.register<{ to: string }>('email.welcome', (payload) => {
    processedEmails.push(payload.to);
    log(quiet, `[email.welcome] sent to ${payload.to}`);
  });

  // (b) A delayed job: a reminder that only runs once its delay elapses.
  queue.register<{ userId: string }>('reminder.send', (payload) => {
    reminderRan = true;
    reminderRanAt = Date.now();
    log(quiet, `[reminder.send] reminded user ${payload.userId}`);
  });

  // (c) A scheduled job: a nightly report. Registered on a cron below.
  queue.register<{ report: string }>('report.nightly', (payload) => {
    log(quiet, `[report.nightly] generated ${payload.report}`);
  });

  // (d) A failing job: always throws so it exhausts its attempts and is
  //     dead-lettered. A tiny fixed backoff keeps the retries fast.
  queue.register<{ id: number }>('flaky.process', () => {
    flakyAttempts += 1;
    log(quiet, `[flaky.process] attempt #${flakyAttempts} — throwing`);
    throw new Error('flaky job always fails');
  });

  // ── (c) Register a cron schedule (fires every minute on the wall clock) ─────
  // We register it to demonstrate the scheduling API; we do NOT wait a full
  // wall-clock minute for it to fire so the example stays fast. Cron parsing is
  // validated synchronously at registration, so a successful call proves the
  // schedule is wired.
  let cronRegistered = false;
  queue.schedule('* * * * *', NightlyReportJob);
  cronRegistered = true;
  log(quiet, '[schedule] nightly report registered on "* * * * *"');

  // ── (a) Dispatch an immediate job ───────────────────────────────────────────
  await queue.dispatch(new WelcomeEmailJob({ to: 'ada@example.com' }));

  // ── (b) Dispatch a delayed job ──────────────────────────────────────────────
  const reminderDelayMs = 50;
  const reminderDispatchedAt = Date.now();
  await queue.dispatch(new ReminderJob({ userId: 'user-42' }), { delay: reminderDelayMs });

  // ── (d) Dispatch an always-failing job with a bounded attempt ceiling ───────
  const flakyId = await queue.dispatch(new FlakyJob({ id: 1 }), {
    maxAttempts: 3,
    backoff: { strategy: 'fixed', delay: 10 },
  });

  // Start a worker with a short poll interval so it consumes work promptly.
  const worker = queue.work({ pollIntervalMs: 10 });
  worker.start();

  // Wait until every demonstrated outcome has settled:
  //  - the welcome email was processed,
  //  - the delayed reminder ran (after its delay + a promotion tick),
  //  - the flaky job exhausted its 3 attempts and was dead-lettered.
  await waitFor(() => processedEmails.length >= 1 && reminderRan);
  await waitForDeadLetter(queue, flakyId);

  const deadLetters = await queue.deadLetters.list('default');
  const flakyRecord = deadLetters.find((r) => r.id === flakyId);

  const result: ExampleResult = {
    processedEmails: [...processedEmails],
    reminderRan,
    reminderRanAt,
    reminderDispatchedAt,
    reminderDelayMs,
    flakyAttempts,
    deadLetteredIds: deadLetters.map((r) => r.id),
    deadLetterError: flakyRecord?.error.message,
    cronRegistered,
  };

  log(quiet, '\n── Summary ──────────────────────────────────────────────');
  log(quiet, `processed emails : ${result.processedEmails.join(', ')}`);
  log(quiet, `reminder ran     : ${result.reminderRan} (after ~${result.reminderDelayMs}ms)`);
  log(quiet, `flaky attempts   : ${result.flakyAttempts}`);
  log(quiet, `dead-lettered    : ${result.deadLetteredIds.length} job(s) — ${result.deadLetterError ?? 'n/a'}`);
  log(quiet, `cron registered  : ${result.cronRegistered}`);

  // Exit cleanly: stop the worker + scheduler, drain in-flight, close the driver.
  await queue.close();

  return result;
}

/** Poll the DLQ until the given job id appears (or time out). */
async function waitForDeadLetter(queue: Queue, jobId: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const records = await queue.deadLetters.list('default');
    if (records.some((r) => r.id === jobId)) {
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for the flaky job to be dead-lettered');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// When run directly (`node dist/examples/basic.js`), execute and exit.
// `import.meta.url` matching the invoked script is the ESM equivalent of the
// CommonJS `require.main === module` guard.
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().then(
    () => {
      process.exit(0);
    },
    (err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('example failed:', err);
      process.exit(1);
    },
  );
}
