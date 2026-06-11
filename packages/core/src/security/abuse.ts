// src/security/abuse.ts
// Phase 6 — Abuse_Engine (Requirement 7).
//
// A counter-backed abuse-prevention engine consulted by the authentication path
// (composes the JWT/session/auth primitives). It is built entirely over the
// pluggable `CounterStore` sliding-window abstraction from `store.ts`, so it
// runs in-memory by default and can be backed by a shared external store for
// consistent enforcement across multiple application instances.
//
// Responsibilities (mapped to acceptance criteria):
//   - Account lockout after repeated failed logins within a window (R7.1/R7.2).
//   - Per-source signup throttling within a window (R7.3).
//   - Password-spray classification across distinct accounts (R7.4).
//   - A composite suspicious-activity score from configured signals (R7.5),
//     including the IP-reputation hook (R7.7), with a configured response
//     action triggered once the score threshold is reached (R7.6).
//
// All time inputs are explicit milliseconds; an injected clock supplies the
// default "now" so window timing is fully deterministic under test.

import type { Clock, CounterStore } from './store.js';
import { systemClock } from './store.js';

/**
 * Configuration for the {@link AbuseEngine}. Thresholds and windows are all
 * explicit so the engine's behavior is fully determined by configuration plus
 * the recorded counter state.
 */
export interface AbuseConfig {
  /** Failed logins for one account within {@link loginWindowMs} that trip a lockout (R7.1). */
  loginFailureThreshold: number;
  /** Sliding window (ms) over which failed logins are counted (R7.1). */
  loginWindowMs: number;
  /** Duration (ms) an account remains locked out once tripped (R7.1/R7.2). */
  lockoutMs: number;
  /** Signup attempts from one source within {@link signupWindowMs} that trip throttling (R7.3). */
  signupThreshold: number;
  /** Sliding window (ms) over which signup attempts are counted (R7.3). */
  signupWindowMs: number;
  /** Distinct accounts targeted from one source that classify activity as a spray (R7.4). */
  sprayDistinctAccounts: number;
  /** Sliding window (ms) over which password-spray activity is evaluated (R7.4). */
  sprayWindowMs: number;
  /** Suspicious-activity score at/above which the response action is triggered (R7.6). */
  scoreThreshold: number;
  /**
   * Optional response action invoked once a computed score reaches
   * {@link scoreThreshold} during a login attempt (R7.6). The decision that
   * triggered the action is passed for context.
   */
  responseAction?: (decision: AbuseDecision) => void | Promise<void>;
}

/** A single authentication-attempt signal fed to the engine. */
export interface AuthSignal {
  /** Source IP address of the attempt. */
  ip: string;
  /** Targeted account identifier, when known. */
  accountId?: string;
  /** Whether the authentication attempt failed (bad credentials). */
  failed: boolean;
  /** Timestamp of the attempt in milliseconds. */
  ts: number;
}

/** The reason an attempt was refused, when {@link AbuseDecision.allowed} is false. */
export type AbuseReason = 'LOCKED_OUT' | 'SIGNUP_THROTTLED' | 'SCORE_EXCEEDED';

/** Structured decision returned by the engine for an authentication attempt. */
export interface AbuseDecision {
  /** Whether the attempt is permitted to proceed. */
  allowed: boolean;
  /** Why the attempt was refused, when not allowed. */
  reason?: AbuseReason;
  /** Suggested wait (ms) before retrying, when refused for a time-bounded reason. */
  retryAfterMs?: number;
  /** The suspicious-activity score computed for this attempt (R7.5). */
  score: number;
}

/**
 * Optional IP-reputation hook consulted during authentication attempts (R7.7).
 * Implementations return a non-negative reputation/risk contribution that is
 * folded into the suspicious-activity score; higher means more suspicious.
 */
export type IpReputationHook = (ip: string) => Promise<number>;

/**
 * Counter-backed abuse-prevention engine (R7).
 *
 * The engine derives every stateful decision from sliding-window counters in
 * the injected {@link CounterStore}; no per-account or per-IP mutable state is
 * held on the instance itself, so the same store can be shared across
 * application instances for consistent enforcement.
 */
export class AbuseEngine {
  private readonly cfg: AbuseConfig;
  private readonly store: CounterStore;
  private readonly ipReputation?: IpReputationHook;
  private readonly clock: Clock;

  constructor(
    cfg: AbuseConfig,
    store: CounterStore,
    ipReputation?: IpReputationHook,
    opts: { clock?: Clock } = {},
  ) {
    this.cfg = cfg;
    this.store = store;
    this.ipReputation = ipReputation;
    this.clock = opts.clock ?? systemClock;
  }

  // --- Key helpers (namespaced so a shared store can host many subsystems) ---

  private loginFailKey(accountId: string): string {
    return `abuse:login-fail:${accountId}`;
  }

  private lockoutKey(accountId: string): string {
    return `abuse:lockout:${accountId}`;
  }

  private signupKey(ip: string): string {
    return `abuse:signup:${ip}`;
  }

  /** Per-(source, account) marker used to count an account only once per window. */
  private sprayPairKey(ip: string, accountId: string): string {
    return `abuse:spray-pair:${ip}:${accountId}`;
  }

  /** Per-source distinct-account counter feeding spray classification. */
  private sprayDistinctKey(ip: string): string {
    return `abuse:spray-distinct:${ip}`;
  }

  /**
   * Record a login attempt and return a structured decision (R7.1/R7.2/R7.5/R7.6).
   *
   * Order of evaluation:
   *  1. If the account is already locked out, refuse immediately (R7.2).
   *  2. On a failed attempt, record the failure, advance spray tracking, and
   *     trip a lockout once the failure threshold is reached (R7.1/R7.4).
   *  3. If the attempt just tripped (or is under) a lockout, refuse (R7.2).
   *  4. Otherwise compute the score; if it reaches the threshold, trigger the
   *     configured response action and refuse (R7.5/R7.6).
   */
  async recordLoginAttempt(signal: AuthSignal): Promise<AbuseDecision> {
    const { ip, accountId, failed, ts } = signal;

    if (accountId && (await this.isLockedOut(accountId, ts))) {
      return {
        allowed: false,
        reason: 'LOCKED_OUT',
        retryAfterMs: this.cfg.lockoutMs,
        score: await this.score(signal),
      };
    }

    if (failed && accountId) {
      const failCount = await this.store.increment(this.loginFailKey(accountId), ts, this.cfg.loginWindowMs);

      // Count this account toward the source's distinct-account spray total only
      // the first time it is seen within the spray window.
      const pairCount = await this.store.increment(this.sprayPairKey(ip, accountId), ts, this.cfg.sprayWindowMs);
      if (pairCount === 1) {
        await this.store.increment(this.sprayDistinctKey(ip), ts, this.cfg.sprayWindowMs);
      }

      // Trip the lockout once the failure threshold is reached (R7.1).
      if (failCount >= this.cfg.loginFailureThreshold) {
        await this.store.increment(this.lockoutKey(accountId), ts, this.cfg.lockoutMs);
      }
    }

    // The failure above may have just tripped a lockout; refuse if so (R7.2).
    if (accountId && (await this.isLockedOut(accountId, ts))) {
      return {
        allowed: false,
        reason: 'LOCKED_OUT',
        retryAfterMs: this.cfg.lockoutMs,
        score: await this.score(signal),
      };
    }

    const score = await this.score(signal);
    if (score >= this.cfg.scoreThreshold) {
      const decision: AbuseDecision = { allowed: false, reason: 'SCORE_EXCEEDED', score };
      await this.cfg.responseAction?.(decision);
      return decision;
    }

    return { allowed: true, score };
  }

  /**
   * Record a signup attempt from a source and return a decision (R7.3).
   *
   * Once the per-source attempt count reaches the configured threshold within
   * the window, further attempts from that source are throttled.
   */
  async recordSignupAttempt(ip: string, ts: number): Promise<AbuseDecision> {
    const count = await this.store.increment(this.signupKey(ip), ts, this.cfg.signupWindowMs);
    if (count >= this.cfg.signupThreshold) {
      return {
        allowed: false,
        reason: 'SIGNUP_THROTTLED',
        retryAfterMs: this.cfg.signupWindowMs,
        score: 0,
      };
    }
    return { allowed: true, score: 0 };
  }

  /**
   * Whether `accountId` is currently in Account_Lockout (R7.2). A lockout marker
   * is recorded with a {@link AbuseConfig.lockoutMs} window, so the account is
   * considered locked out while any marker remains within that window.
   */
  async isLockedOut(accountId: string, now: number = this.clock()): Promise<boolean> {
    const active = await this.store.count(this.lockoutKey(accountId), now, this.cfg.lockoutMs);
    return active > 0;
  }

  /**
   * Whether failed logins from `ip` span at least the configured number of
   * distinct accounts within the spray window, classifying the activity as a
   * password-spray pattern (R7.4).
   */
  async detectPasswordSpray(ip: string, now: number = this.clock()): Promise<boolean> {
    const distinct = await this.store.count(this.sprayDistinctKey(ip), now, this.cfg.sprayWindowMs);
    return distinct >= this.cfg.sprayDistinctAccounts;
  }

  /**
   * Compute a suspicious-activity score from configured signals (R7.5),
   * consulting the IP-reputation hook when configured (R7.7). The score is a
   * non-negative sum of:
   *   - recent failed-login count for the targeted account,
   *   - distinct accounts targeted from the source (spray pressure),
   *   - the IP-reputation hook's contribution.
   */
  async score(signal: AuthSignal): Promise<number> {
    const { ip, accountId, ts } = signal;
    let total = 0;

    if (accountId) {
      total += await this.store.count(this.loginFailKey(accountId), ts, this.cfg.loginWindowMs);
    }

    total += await this.store.count(this.sprayDistinctKey(ip), ts, this.cfg.sprayWindowMs);

    if (this.ipReputation) {
      total += await this.ipReputation(ip);
    }

    return total;
  }
}
