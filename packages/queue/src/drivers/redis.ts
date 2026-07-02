// src/drivers/redis.ts
// @streetjs/queue — the durable, multi-worker Redis driver (Req 1.3, 3.3, 3.4,
// 8.1, 8.2, 12.4, 12.6, 13.1, 13.3, 14.1).
//
// IMPORTANT: `RedisDriver` / `RedisDriverOptions` are exported ONLY from this
// module and reached exclusively through the opt-in `@streetjs/queue/redis`
// submodule export. They are intentionally NOT re-exported from `src/index.ts`
// so Memory-driver users pull in no extra runtime dependencies (Req 1.3).
//
// ── Design (source of truth: design.md "RedisDriver" + task 15.1) ────────────
//
// The driver is built on the core zero-dependency `RedisClient`
// (`command(args)` + `PUBLISH`/`SUBSCRIBE`). The core client has NO blocking
// commands (no BRPOPLPUSH), NO pipelines, NO Lua/EVAL, and NO MULTI/transactions
// (verified in `packages/core/src/transports/resp.ts`). The driver therefore
// uses **poll + pub/sub wake-up** (never BRPOPLPUSH) and treats
// reserve-then-execute as *best-effort-atomic*: a per-reservation token plus a
// visibility lease lets a double-reserved job be detected at `ack` (the loser is
// a no-op that does not double-remove), yielding **at-least-once** (not
// exactly-once) delivery (Req 14.1).
//
// Keyspace (namespaced by `keyPrefix`, default `streetjs:queue`):
//   {p}:queues                     SET   — registry of all known queue names
//   {p}:{queue}:ready              ZSET  — member = job id, score = readyScore()
//   {p}:{queue}:delayed            ZSET  — member = job id, score = runAt (epoch ms)
//   {p}:{queue}:processing         ZSET  — member = token,  score = leaseExpiresAt
//   {p}:{queue}:dead               LIST  — RPUSH of DeadLetterRecord JSON strings
//   {p}:job:{id}                   STR   — the JobEnvelope JSON (referenced by id)
//   {p}:res:{token}                STR   — reservation ref JSON { id, queue }
//   {p}:owner:{id}                 STR   — the token that currently owns job id
//
// Ready-score encoding (Req 8.1, 8.2):
//   score = seq - priority * PRIORITY_MULT
//   Higher priority ⇒ a strictly SMALLER score ⇒ popped first by `ZRANGE 0 0`
//   (ascending). Equal priority ⇒ ascending `seq` ⇒ FIFO by enqueue order.
//   PRIORITY_MULT = 2^40. Documented assumption: `priority` is an integer with
//   |priority| < 2^11 and `seq` is an integer in [0, 2^40); then the encoded
//   score is an exact integer within 2^53 (IEEE-754 double), so priority always
//   dominates seq and no precision loss reorders jobs.
//
// Envelope storage: the full `JobEnvelope` is stored once as a JSON string under
// `{p}:job:{id}` and referenced by id from the ready/delayed ZSETs and the
// processing set. `attempts` is incremented on the stored envelope at `reserve`
// (mirrors the MemoryDriver, which increments the shared object). Because the
// facade/worker may mutate `reservation.envelope` after reserving (e.g. the rate
// limiter decrements `attempts` before a deferral nack), `nack` and
// `moveToDeadLetter` re-persist `reservation.envelope` so those mutations are
// faithful.
//
// Health (Req 12.4, 12.6): a `connected` flag is set after `init()` (connect +
// PING) succeeds. A *connection-level* failure — the core client throwing
// "RedisClient not connected" (its socket is gone) — flips `connected` to
// `down`. A *per-command* failure — a RESP error reply (e.g. auth error, WRONGTYPE,
// a command timeout) surfaced as an `ERR:` string — is thrown to the caller but
// does NOT flip health, so the check stays `up` while the connection is alive.
//
// Pub/sub (Req 14.1, latency only): `onWake` SUBSCRIBEs to `{p}:wake`; `enqueue`
// and `promoteDue` PUBLISH the woken queue name. Pub/sub is a wake-up
// optimization ONLY — correctness never depends on a message arriving. The core
// client exposes no reconnection event, so SUBSCRIBE is (re)established inside
// `init()`; calling `init()` again after a reconnect resumes the subscription
// (documented limitation).

import type { RespValue } from 'streetjs';
import type { JobEnvelope, DeadLetterRecord, SerializedError } from '../job.js';
import type { QueueDriver, Reservation, QueueStats } from './driver.js';

/**
 * The subset of the core `RedisClient` surface the driver needs. The core
 * `RedisClient` (exported from `streetjs`) satisfies this interface, and a
 * simulated in-memory Redis can implement it to drive the behavioral-equivalence
 * property test (task 15.2) with no real broker.
 */
export interface RedisClientLike {
  /** Establish the connection; MUST reject if the backend is unreachable. */
  connect(): Promise<void>;
  /** Issue a RESP command; replies are multiplexed FIFO on one socket. */
  command(args: (string | number)[]): Promise<RespValue>;
  /** Fire-and-forget publish used only as a wake-up latency optimization. */
  publish(channel: string, message: string): Promise<void>;
  /** Open a dedicated subscription; returns an unsubscribe function. */
  subscribe(channel: string, handler: (message: string) => void): Promise<() => void>;
  /** Release the connection. */
  close(): void | Promise<void>;
}

/** Options for the opt-in Redis-backed queue driver. */
export interface RedisDriverOptions {
  /** The core `RedisClient` (or a compatible client) for storage and pub/sub. */
  client: RedisClientLike;
  /** Key prefix namespacing all queue keys. Default "streetjs:queue". */
  keyPrefix?: string;
  /** Visibility lease (ms) for reservations before crash-reclaim. Default 30000. */
  visibilityMs?: number;
}

/**
 * Ready-score multiplier. See the module header: priority is scaled by 2^40 so
 * it dominates the seq tie-break while the encoded score stays an exact integer
 * within 2^53 for the documented priority/seq ranges.
 */
const PRIORITY_MULT = 2 ** 40;

/** Durable, multi-worker `QueueDriver` shipped behind `@streetjs/queue/redis`. */
export class RedisDriver implements QueueDriver {
  protected readonly client: RedisClientLike;
  protected readonly keyPrefix: string;
  protected readonly visibilityMs: number;

  /** True once init() (connect + PING) has succeeded and the connection is live. */
  private connected = false;
  /** Registered wake handler (latency optimization); re-subscribed on init. */
  private wakeHandler: ((queue: string) => void) | null = null;
  /** Unsubscribe function for the active wake subscription, if any. */
  private wakeUnsub: (() => void) | null = null;

  constructor(options: RedisDriverOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'streetjs:queue';
    this.visibilityMs = options.visibilityMs ?? 30_000;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * One-time init: connect and verify the backend is actually reachable with a
   * PING. Rejects if the backend is unreachable (Req 13.3). On success sets the
   * `connected` flag and (re)establishes the wake subscription if one was
   * registered (resume-on-reconnect).
   */
  async init(): Promise<void> {
    await this.client.connect();
    // Verify RESP-level reachability, not just a TCP handshake.
    const pong = await this.client.command(['PING']);
    if (typeof pong === 'string' && pong.startsWith('ERR:')) {
      throw new Error(`RedisDriver.init: backend rejected PING (${pong.slice(4)})`);
    }
    this.connected = true;
    // Resume the wake subscription on (re)connect (documented limitation: the
    // core client surfaces no reconnection event, so this runs on each init).
    if (this.wakeHandler && !this.wakeUnsub) {
      await this.establishWakeSubscription();
    }
  }

  /** Graceful shutdown: unsubscribe, close the client, mark disconnected. */
  async close(): Promise<void> {
    if (this.wakeUnsub) {
      try {
        this.wakeUnsub();
      } catch {
        // best-effort
      }
      this.wakeUnsub = null;
    }
    try {
      await this.client.close();
    } finally {
      this.connected = false;
    }
  }

  // ── Enqueue ─────────────────────────────────────────────────────────────────

  async enqueue(queue: string, envelope: JobEnvelope): Promise<void> {
    await this.registerQueue(queue);
    await this.persistEnvelope(envelope);
    await this.cmd(['ZADD', this.readyKey(queue), this.readyScore(envelope), envelope.id]);
    // Wake idle workers (latency only; never required for correctness).
    await this.wake(queue);
  }

  async enqueueDelayed(queue: string, envelope: JobEnvelope, runAt: number): Promise<void> {
    await this.registerQueue(queue);
    await this.persistEnvelope(envelope);
    await this.cmd(['ZADD', this.delayedKey(queue), runAt, envelope.id]);
  }

  // ── Reserve / ack / nack ─────────────────────────────────────────────────────

  /**
   * Reclaim expired leases across all known queues, then pop the highest-priority
   * ready job from the first non-empty queue in `queues` (cross-queue priority =
   * configured queue order). Grants a visibility lease and a fresh token.
   */
  async reserve(queues: string[], visibilityMs: number, now: number): Promise<Reservation | null> {
    // 1) Reclaim expired leases (crash recovery → at-least-once, Req 14.1).
    await this.reclaimExpiredLeases(now);

    // 2) Pop the highest-priority ready job across the requested queues in order.
    for (const queue of queues) {
      const readyKey = this.readyKey(queue);
      // Bounded retry to skip ids another worker popped first (ZREM lost race).
      for (let attempt = 0; attempt < 16; attempt++) {
        const head = await this.cmd(['ZRANGE', readyKey, 0, 0]);
        const id = asStringArray(head)[0];
        if (id === undefined) {
          break; // this queue is empty; move to the next queue
        }
        // Claim the id: only the worker whose ZREM removes it owns the pop.
        const removed = asInt(await this.cmd(['ZREM', readyKey, id]));
        if (removed !== 1) {
          continue; // another worker claimed it first; try the next head
        }
        const envelope = await this.loadEnvelope<unknown>(id);
        if (envelope === null) {
          continue; // dangling id (envelope gone); skip it
        }
        // Attempt is consumed at reserve (mirrors MemoryDriver).
        envelope.attempts += 1;
        await this.persistEnvelope(envelope);

        const token = this.newToken();
        const leaseExpiresAt = now + visibilityMs;
        await this.cmd(['ZADD', this.processingKey(queue), leaseExpiresAt, token]);
        await this.cmd(['SET', this.resKey(token), JSON.stringify({ id, queue })]);
        await this.cmd(['SET', this.ownerKey(id), token]);

        return { envelope, token, queue, leaseExpiresAt } as Reservation;
      }
    }
    return null;
  }

  /**
   * Acknowledge successful processing. Validates ownership: if this reservation's
   * token still owns the job it is permanently removed; if the token no longer
   * owns the slot (the lease was reclaimed and the job re-reserved by another
   * worker) the loser is a NO-OP — it does not double-remove the winner's job
   * (best-effort at-least-once, Req 14.1).
   */
  async ack(reservation: Reservation): Promise<void> {
    const id = reservation.envelope.id;
    const owner = asStringOrNull(await this.cmd(['GET', this.ownerKey(id)]));
    if (owner !== reservation.token) {
      // Loser: another reservation owns the job now. Clean only our own ref.
      await this.cmd(['DEL', this.resKey(reservation.token)]);
      await this.cmd(['ZREM', this.processingKey(reservation.queue), reservation.token]);
      return;
    }
    await this.removeReservationState(reservation);
    await this.cmd(['DEL', this.jobKey(id)]);
  }

  /**
   * Negative-ack: return the job to ready (or delayed at `runAt`). If this
   * reservation no longer owns the slot (already reclaimed/re-reserved) it is a
   * no-op so the job is not resurrected/duplicated. Re-persists
   * `reservation.envelope` so any facade-side mutations (e.g. the rate limiter's
   * attempts decrement) are faithful.
   */
  async nack(reservation: Reservation, runAt?: number): Promise<void> {
    const id = reservation.envelope.id;
    const owner = asStringOrNull(await this.cmd(['GET', this.ownerKey(id)]));
    if (owner !== reservation.token) {
      await this.cmd(['DEL', this.resKey(reservation.token)]);
      await this.cmd(['ZREM', this.processingKey(reservation.queue), reservation.token]);
      return;
    }
    await this.removeReservationState(reservation);
    await this.registerQueue(reservation.queue);
    await this.persistEnvelope(reservation.envelope);
    if (runAt !== undefined) {
      await this.cmd(['ZADD', this.delayedKey(reservation.queue), runAt, id]);
    } else {
      await this.cmd(['ZADD', this.readyKey(reservation.queue), this.readyScore(reservation.envelope), id]);
      await this.wake(reservation.queue);
    }
  }

  // ── Delayed promotion ─────────────────────────────────────────────────────────

  /**
   * Promote every delayed job whose `runAt <= now` into its ready queue, across
   * all known queues (Req 3.3, 3.4). Returns the number promoted.
   */
  async promoteDue(now: number): Promise<number> {
    let promoted = 0;
    for (const queue of await this.knownQueues()) {
      const delayedKey = this.delayedKey(queue);
      const due = asStringArray(await this.cmd(['ZRANGEBYSCORE', delayedKey, '-inf', now]));
      for (const id of due) {
        const removed = asInt(await this.cmd(['ZREM', delayedKey, id]));
        if (removed !== 1) {
          continue; // another instance promoted it first
        }
        const envelope = await this.loadEnvelope<unknown>(id);
        if (envelope === null) {
          continue;
        }
        await this.cmd(['ZADD', this.readyKey(queue), this.readyScore(envelope), id]);
        promoted += 1;
      }
      if (due.length > 0) {
        await this.wake(queue);
      }
    }
    return promoted;
  }

  // ── Dead-letter ────────────────────────────────────────────────────────────

  async moveToDeadLetter(reservation: Reservation, error: SerializedError): Promise<void> {
    const envelope = reservation.envelope;
    await this.removeReservationState(reservation);
    await this.registerQueue(reservation.queue);
    const record: DeadLetterRecord = {
      id: envelope.id,
      type: envelope.type,
      queue: reservation.queue,
      payload: envelope.payload,
      attempts: envelope.attempts,
      maxAttempts: envelope.maxAttempts,
      backoff: envelope.backoff,
      error,
      enqueuedAt: envelope.enqueuedAt,
      failedAt: Date.now(),
    };
    await this.cmd(['RPUSH', this.deadKey(reservation.queue), JSON.stringify(record)]);
    await this.cmd(['DEL', this.jobKey(envelope.id)]);
  }

  async listDeadLetters(queue: string | undefined, limit: number): Promise<DeadLetterRecord[]> {
    const queues = queue !== undefined ? [queue] : await this.knownQueues();
    const records: DeadLetterRecord[] = [];
    for (const q of queues) {
      const raw = asStringArray(await this.cmd(['LRANGE', this.deadKey(q), 0, -1]));
      for (const s of raw) {
        const parsed = safeParse<DeadLetterRecord>(s);
        if (parsed !== null) {
          records.push(parsed);
        }
      }
    }
    return limit >= 0 ? records.slice(0, limit) : records;
  }

  async removeDeadLetter(jobId: string): Promise<DeadLetterRecord | null> {
    for (const q of await this.knownQueues()) {
      const deadKey = this.deadKey(q);
      const raw = asStringArray(await this.cmd(['LRANGE', deadKey, 0, -1]));
      for (const s of raw) {
        const parsed = safeParse<DeadLetterRecord>(s);
        if (parsed !== null && parsed.id === jobId) {
          // LREM removes the exact stored JSON string (unique per record).
          await this.cmd(['LREM', deadKey, 0, s]);
          return parsed;
        }
      }
    }
    return null;
  }

  async flushDeadLetters(queue?: string): Promise<number> {
    const queues = queue !== undefined ? [queue] : await this.knownQueues();
    let removed = 0;
    for (const q of queues) {
      removed += asInt(await this.cmd(['LLEN', this.deadKey(q)]));
      await this.cmd(['DEL', this.deadKey(q)]);
    }
    return removed;
  }

  // ── Stats / purge / health ────────────────────────────────────────────────

  /** Best-effort live snapshot; never throws (Req 12.3). */
  async stats(queue?: string): Promise<QueueStats> {
    try {
      const queues = queue !== undefined ? [queue] : await this.knownQueues();
      let ready = 0;
      let delayed = 0;
      let deadLettered = 0;
      let reserved = 0;
      for (const q of queues) {
        ready += asInt(await this.cmd(['ZCARD', this.readyKey(q)]));
        delayed += asInt(await this.cmd(['ZCARD', this.delayedKey(q)]));
        deadLettered += asInt(await this.cmd(['LLEN', this.deadKey(q)]));
        reserved += asInt(await this.cmd(['ZCARD', this.processingKey(q)]));
      }
      return { ready, delayed, deadLettered, reserved };
    } catch {
      return { ready: 0, delayed: 0, deadLettered: 0, reserved: 0 };
    }
  }

  /** Remove all ready + delayed jobs (and their envelopes) for a queue. */
  async purge(queue?: string): Promise<number> {
    const queues = queue !== undefined ? [queue] : await this.knownQueues();
    let removed = 0;
    for (const q of queues) {
      const ids = [
        ...asStringArray(await this.cmd(['ZRANGE', this.readyKey(q), 0, -1])),
        ...asStringArray(await this.cmd(['ZRANGE', this.delayedKey(q), 0, -1])),
      ];
      for (const id of ids) {
        await this.cmd(['DEL', this.jobKey(id)]);
        await this.cmd(['DEL', this.ownerKey(id)]);
      }
      removed += ids.length;
      await this.cmd(['DEL', this.readyKey(q)]);
      await this.cmd(['DEL', this.delayedKey(q)]);
    }
    return removed;
  }

  /**
   * Connectivity for the health check. Reports `down` only on connection loss;
   * a per-command failure while the connection is alive leaves it `up`
   * (Req 12.4, 12.6).
   */
  health(): { status: 'up' | 'down'; details?: Record<string, unknown> } {
    return this.connected
      ? { status: 'up' }
      : { status: 'down', details: { reason: 'redis connection lost' } };
  }

  // ── Wake-up (pub/sub, latency only) ──────────────────────────────────────────

  /**
   * Register a wake handler. Pub/sub is a latency optimization ONLY: workers poll
   * regardless, so a lost message never affects correctness (Req 14.1).
   */
  onWake(handler: (queue: string) => void): void {
    this.wakeHandler = handler;
    if (this.connected && !this.wakeUnsub) {
      // Fire-and-forget; a failed subscribe just means workers rely on polling.
      void this.establishWakeSubscription();
    }
  }

  private async establishWakeSubscription(): Promise<void> {
    const handler = this.wakeHandler;
    if (!handler) {
      return;
    }
    try {
      this.wakeUnsub = await this.client.subscribe(this.wakeChannel(), (message) => {
        handler(message);
      });
    } catch {
      // Subscription is best-effort; workers still make progress by polling.
      this.wakeUnsub = null;
    }
  }

  private async wake(queue: string): Promise<void> {
    try {
      await this.client.publish(this.wakeChannel(), queue);
    } catch {
      // Never let a wake-up failure affect the correctness path.
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────────

  /**
   * Issue a command. A synchronous throw from the client means the connection is
   * gone → flip health to `down` and rethrow (connection-level, Req 12.4). A RESP
   * `ERR:` reply is a per-command failure (auth/timeout/WRONGTYPE) → rethrow but
   * DO NOT touch the connected flag (Req 12.6).
   */
  private async cmd(args: (string | number)[]): Promise<RespValue> {
    let reply: RespValue;
    try {
      reply = await this.client.command(args);
    } catch (err) {
      // The core client throws "RedisClient not connected" when its socket is gone.
      this.connected = false;
      throw err;
    }
    if (typeof reply === 'string' && reply.startsWith('ERR:')) {
      throw new Error(`Redis command failed: ${reply.slice(4)}`);
    }
    return reply;
  }

  /** Reclaim leases whose expiry has passed (<= now) across all known queues. */
  private async reclaimExpiredLeases(now: number): Promise<void> {
    for (const queue of await this.knownQueues()) {
      const processingKey = this.processingKey(queue);
      const expired = asStringArray(await this.cmd(['ZRANGEBYSCORE', processingKey, '-inf', now]));
      for (const token of expired) {
        const removed = asInt(await this.cmd(['ZREM', processingKey, token]));
        if (removed !== 1) {
          continue; // another worker reclaimed it first
        }
        const ref = safeParse<{ id: string; queue: string }>(
          asStringOrNull(await this.cmd(['GET', this.resKey(token)])) ?? '',
        );
        await this.cmd(['DEL', this.resKey(token)]);
        if (ref === null) {
          continue;
        }
        const envelope = await this.loadEnvelope<unknown>(ref.id);
        if (envelope === null) {
          await this.cmd(['DEL', this.ownerKey(ref.id)]);
          continue;
        }
        // Return the job to ready; clear ownership so the stale reservation's
        // ack/nack becomes a no-op loser.
        await this.cmd(['ZADD', this.readyKey(ref.queue), this.readyScore(envelope), ref.id]);
        await this.cmd(['DEL', this.ownerKey(ref.id)]);
        await this.wake(ref.queue);
      }
    }
  }

  /** Remove the processing entry, reservation ref, and ownership for a reservation. */
  private async removeReservationState(reservation: Reservation): Promise<void> {
    await this.cmd(['ZREM', this.processingKey(reservation.queue), reservation.token]);
    await this.cmd(['DEL', this.resKey(reservation.token)]);
    await this.cmd(['DEL', this.ownerKey(reservation.envelope.id)]);
  }

  private async registerQueue(queue: string): Promise<void> {
    await this.cmd(['SADD', this.queuesKey(), queue]);
  }

  private async knownQueues(): Promise<string[]> {
    return asStringArray(await this.cmd(['SMEMBERS', this.queuesKey()]));
  }

  private async persistEnvelope(envelope: JobEnvelope): Promise<void> {
    await this.cmd(['SET', this.jobKey(envelope.id), JSON.stringify(envelope)]);
  }

  private async loadEnvelope<T>(id: string): Promise<JobEnvelope<T> | null> {
    const raw = asStringOrNull(await this.cmd(['GET', this.jobKey(id)]));
    return raw === null ? null : safeParse<JobEnvelope<T>>(raw);
  }

  /** Composite ready score: higher priority ⇒ smaller score, FIFO by seq on ties. */
  private readyScore(envelope: JobEnvelope): number {
    return envelope.seq - envelope.priority * PRIORITY_MULT;
  }

  private newToken(): string {
    // Per-reservation token; only used to validate ack/nack ownership.
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${(RedisDriver.tokenSeq++).toString(36)}`;
  }

  private static tokenSeq = 0;

  // ── Key builders ─────────────────────────────────────────────────────────────

  private queuesKey(): string {
    return `${this.keyPrefix}:queues`;
  }
  private readyKey(queue: string): string {
    return `${this.keyPrefix}:${queue}:ready`;
  }
  private delayedKey(queue: string): string {
    return `${this.keyPrefix}:${queue}:delayed`;
  }
  private processingKey(queue: string): string {
    return `${this.keyPrefix}:${queue}:processing`;
  }
  private deadKey(queue: string): string {
    return `${this.keyPrefix}:${queue}:dead`;
  }
  private jobKey(id: string): string {
    return `${this.keyPrefix}:job:${id}`;
  }
  private resKey(token: string): string {
    return `${this.keyPrefix}:res:${token}`;
  }
  private ownerKey(id: string): string {
    return `${this.keyPrefix}:owner:${id}`;
  }
  private wakeChannel(): string {
    return `${this.keyPrefix}:wake`;
  }
}

// ── Defensive RESP parsing helpers ─────────────────────────────────────────────

/** Coerce a RESP reply to an integer (RESP integers arrive as `number`). */
function asInt(reply: RespValue): number {
  if (typeof reply === 'number') {
    return reply;
  }
  if (typeof reply === 'string') {
    const n = Number(reply);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Coerce a RESP reply to `string | null` (bulk strings / null replies). */
function asStringOrNull(reply: RespValue): string | null {
  return typeof reply === 'string' ? reply : null;
}

/** Coerce a RESP array reply to a `string[]`, dropping non-string elements. */
function asStringArray(reply: RespValue): string[] {
  if (!Array.isArray(reply)) {
    return [];
  }
  const out: string[] = [];
  for (const el of reply) {
    if (typeof el === 'string') {
      out.push(el);
    }
  }
  return out;
}

/** Parse JSON, returning null on any error (defensive against corrupt values). */
function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
