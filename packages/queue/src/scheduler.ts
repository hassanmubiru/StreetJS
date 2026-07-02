// src/scheduler.ts
// @streetjs/queue — delayed-job promotion loop + cron scheduling (Req 3.1, 3.2,
// 4.1–4.6, 5.1).
//
// Two responsibilities, both layered over reused core primitives:
//
//  1. **Delayed-job promotion** — a tick loop (`setInterval`, unref'd) that calls
//     `driver.promoteDue(clock())` so a delayed/scheduled job becomes eligible
//     for reservation only once the clock reaches its Due_Time (Req 3.3, 3.4).
//     The loop is started explicitly (from the facade's `work()` path), never on
//     mere `createQueue`, so the deterministic `TestHarness` — which drives
//     `promoteDue` itself — stays deterministic and leaks no timers.
//
//  2. **Cron scheduling** — `schedule(cron, job, options)` delegates cron parsing
//     and next-fire computation to the reused core `CronScheduler` (Req 4.1),
//     surfacing `CronParseError` synchronously at registration with no partial
//     registration (Req 4.3). On each fire the scheduler dispatches a *fresh*
//     job instance through the facade (Req 4.2): a constructor is re-instantiated
//     per fire (`new Ctor()`), an instance is re-dispatched. Single-instance
//     overlap is prevented by `CronScheduler`'s built-in re-entrancy guard
//     (Req 4.4); an optional distributed lock guards each fire for multi-instance
//     exactly-one-fire (Req 4.5), and without a lock each running instance fires
//     once per tick (Req 4.6).

import { CronScheduler, CronParseError, systemClock } from 'streetjs';
import type { Clock } from 'streetjs';
import { Job, type JobOptions } from './job.js';
import type { QueueDriver } from './drivers/driver.js';

// Re-export so callers can catch the core error type without importing from
// deep inside `streetjs` (Req 4.3).
export { CronParseError };

/**
 * A job source accepted by {@link Scheduler.schedule}: either a zero-arg `Job`
 * constructor (re-instantiated fresh on every fire) or a `Job` instance
 * (re-dispatched on every fire). Mirrors the facade `schedule` signature.
 */
export type ScheduledJob = (new () => Job<unknown>) | Job<unknown>;

/**
 * Minimal distributed-lock seam for multi-instance exactly-one-fire (Req 4.5).
 *
 * When configured, each cron fire is guarded by a per-tick lock keyed by the
 * schedule name and the fire minute, so exactly one instance dispatches per tick
 * even when many instances run the same schedule. The seam is intentionally
 * narrow (a try-acquire returning `null` when another instance already holds the
 * tick) so the core `DistributedLock` — or any equivalent backend lock — can be
 * adapted to it. Without a lock configured, every running instance fires once
 * per tick (Req 4.6).
 */
export interface SchedulerLock {
  /**
   * Try to acquire the lock for `key`, holding it for at most `ttlMs`. Resolves
   * with a handle whose `release()` frees the lock early, or `null` when the
   * lock is already held (this instance must skip the fire).
   */
  tryAcquire(key: string, ttlMs: number): Promise<LockAcquisition | null>;
}

/** A held lock returned by {@link SchedulerLock.tryAcquire}. */
export interface LockAcquisition {
  /** Release the lock. Safe to call more than once. */
  release(): Promise<void>;
}

export interface SchedulerOptions {
  /** Injected clock (`() => number`); defaults to wall-clock time. */
  clock?: Clock;
  /** Delayed-promotion tick interval in ms. Default 1000. */
  tickIntervalMs?: number;
  /**
   * Optional distributed lock for multi-instance exactly-one-fire (Req 4.5).
   * When omitted, each running instance fires once per tick (Req 4.6).
   */
  lock?: SchedulerLock;
  /**
   * TTL (ms) a per-fire tick lock is held. Defaults to 55_000 — long enough to
   * cover the fire window of a one-minute cron tick so a straggler on the same
   * tick cannot double-fire, short enough to release before the next tick.
   */
  lockTtlMs?: number;
}

/** Default delayed-promotion tick interval (ms). */
const DEFAULT_TICK_INTERVAL_MS = 1000;
/** Default TTL (ms) for a per-fire distributed tick lock. */
const DEFAULT_LOCK_TTL_MS = 55_000;

/**
 * Promotes due delayed jobs and dispatches cron entries through the facade.
 *
 * The scheduler owns one core {@link CronScheduler} per registered schedule (so
 * `start()` schedules each exactly once and a schedule registered after start
 * begins on its own, avoiding the double-timer that a shared scheduler's
 * repeated `start()` would create) plus a single delayed-promotion tick loop.
 */
export class Scheduler {
  /** Injected clock used by the promotion loop and per-fire lock keys. */
  private readonly clockFn: Clock;
  private readonly tickIntervalMs: number;
  private readonly lock?: SchedulerLock;
  private readonly lockTtlMs: number;

  /** One core `CronScheduler` per registered schedule (see class doc). */
  private readonly crons: CronScheduler[] = [];
  /** Monotonic counter for unique per-schedule cron entry names. */
  private cronSeq = 0;

  /** Delayed-promotion tick timer; undefined while stopped. */
  private promotionTimer: ReturnType<typeof setInterval> | undefined;
  /** Guards against overlapping promotion passes (promoteDue is async). */
  private promoting = false;
  /** True while the scheduler is running (promotion loop + cron timers active). */
  private started = false;

  constructor(
    protected readonly driver: QueueDriver,
    protected readonly dispatch: (job: Job<unknown>, options?: JobOptions) => Promise<string>,
    protected readonly options: SchedulerOptions = {},
  ) {
    this.clockFn = options.clock ?? systemClock;
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
    this.lock = options.lock;
    this.lockTtlMs = options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  }

  /**
   * Register a recurring job by cron expression (Req 4.1). Delegates parsing and
   * next-fire computation to the reused core `CronScheduler`; a malformed
   * expression makes `register` throw `CronParseError` synchronously *before*
   * the entry is tracked, so nothing is partially registered (Req 4.3). On each
   * fire a fresh job instance is dispatched through the facade (Req 4.2).
   *
   * If the scheduler is already running, the new schedule begins immediately.
   */
  schedule(cron: string, job: ScheduledJob, options?: JobOptions): void {
    const factory = toJobFactory(job);
    const name = `cron#${this.cronSeq}`;
    const cronScheduler = new CronScheduler();

    // Throws CronParseError synchronously on a bad expression. Because we have
    // not yet pushed `cronScheduler` onto `this.crons`, a throw leaves no
    // partial registration behind (Req 4.3).
    cronScheduler.register(cron, name, () => this.fire(name, factory, options));

    this.crons.push(cronScheduler);
    this.cronSeq += 1;

    // Begin firing at once if the scheduler is already running; otherwise it is
    // started with the rest on start().
    if (this.started) {
      cronScheduler.start();
    }
  }

  /**
   * Begin the delayed-promotion loop and start every registered cron scheduler.
   * Idempotent: repeated calls are a no-op while already running. The promotion
   * timer is `unref`'d so it never keeps the process alive on its own.
   */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    this.promotionTimer = setInterval(() => this.tick(), this.tickIntervalMs);
    this.promotionTimer.unref?.();

    for (const cronScheduler of this.crons) {
      cronScheduler.start();
    }
  }

  /** Stop the promotion loop and every cron scheduler. Safe to call unstarted. */
  async stop(): Promise<void> {
    this.started = false;
    if (this.promotionTimer !== undefined) {
      clearInterval(this.promotionTimer);
      this.promotionTimer = undefined;
    }
    for (const cronScheduler of this.crons) {
      cronScheduler.stop();
    }
  }

  /**
   * One delayed-promotion pass: move every delayed job whose Due_Time has arrived
   * into its ready queue (Req 3.4). Overlapping passes are skipped (promoteDue is
   * async and a slow driver must not pile up ticks), and errors are swallowed so
   * a transient driver failure never crashes the tick loop.
   */
  private tick(): void {
    if (this.promoting) {
      return;
    }
    this.promoting = true;
    void Promise.resolve(this.driver.promoteDue(this.clockFn()))
      .catch(() => undefined)
      .finally(() => {
        this.promoting = false;
      });
  }

  /**
   * Dispatch one cron fire through the facade (Req 4.2). With no lock configured
   * every running instance fires once per tick (Req 4.6). With a lock configured
   * the fire is guarded by a per-tick key so exactly one instance dispatches per
   * tick (Req 4.5); an instance that loses the race skips silently.
   *
   * `CronScheduler`'s re-entrancy guard already prevents this same instance from
   * overlapping fires of the same entry (Req 4.4).
   */
  private async fire(
    name: string,
    factory: () => Job<unknown>,
    options?: JobOptions,
  ): Promise<void> {
    if (this.lock === undefined) {
      await this.dispatch(factory(), options);
      return;
    }

    // Key the lock by the schedule name and the fire minute so all instances
    // firing on the same tick contend for the same key (Req 4.5).
    const tickKey = `queue-cron:${name}:${Math.floor(this.clockFn() / 60_000)}`;
    const handle = await this.lock.tryAcquire(tickKey, this.lockTtlMs);
    if (handle === null) {
      // Another instance won this tick — skip firing here.
      return;
    }
    try {
      await this.dispatch(factory(), options);
    } finally {
      await handle.release();
    }
  }
}

/**
 * Build a per-fire job factory from a scheduled job source. A constructor is
 * re-instantiated fresh on every fire (`new Ctor()`); an instance is re-dispatched
 * as-is. This is what makes each cron fire dispatch a *fresh* job (Req 4.2).
 */
function toJobFactory(job: ScheduledJob): () => Job<unknown> {
  if (job instanceof Job) {
    return () => job;
  }
  const Ctor = job;
  return () => new Ctor();
}
