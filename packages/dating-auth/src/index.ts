// packages/dating-auth/src/index.ts
// @streetjs/dating-auth — Phase 10 consumer-platform reference package (R11.7).
//
// This package introduces NO independent authentication logic. It is a thin
// composition layer over three primitives already shipped by `@streetjs/core`
// (published as `streetjs`):
//
//   - `JwtService`    — token issuance/verification (HMAC-SHA256).
//   - `SessionManager`— AES-256-GCM session sealing/opening.
//   - `AbuseEngine`   — counter-backed login lockout / signup throttling.
//
// Credential checking is intentionally NOT performed here: callers pass the
// already-decided `credentialsValid` outcome (e.g. from a password hash compare
// done elsewhere). The service only orchestrates abuse accounting and, on a
// permitted+valid attempt, mints a token and a sealed session by delegating to
// the core primitives. Every cryptographic and stateful decision is owned by
// core; this package adds only orchestration.

import {
  JwtService,
  SessionManager,
  AbuseEngine,
  InMemoryCounterStore,
  systemClock,
  type JwtPayload,
  type JwtOptions,
  type SessionData,
  type AbuseConfig,
  type AbuseDecision,
  type AbuseReason,
  type IpReputationHook,
  type CounterStore,
  type Clock,
} from 'streetjs';

export type {
  JwtPayload,
  JwtOptions,
  SessionData,
  AbuseConfig,
  AbuseDecision,
  AbuseReason,
  IpReputationHook,
  CounterStore,
  Clock,
};

export const DATING_AUTH_PACKAGE = '@streetjs/dating-auth';
export const DATING_AUTH_VERSION = '1.0.0';

/** Configuration for {@link DatingAuthService}. */
export interface DatingAuthOptions {
  /** Secret for the wrapped {@link JwtService} (≥ 32 chars; validated by core). */
  jwtSecret: string;
  /** 64-char hex key for the wrapped {@link SessionManager} (validated by core). */
  sessionKey: string;
  /** Abuse-engine wiring; the engine itself is provided by core. */
  abuse: {
    /** Thresholds/windows passed straight through to the core {@link AbuseEngine}. */
    config: AbuseConfig;
    /** Counter backing; defaults to a core {@link InMemoryCounterStore}. */
    store?: CounterStore;
    /** Optional IP-reputation hook consulted by the core engine. */
    ipReputation?: IpReputationHook;
    /** Injected clock for deterministic windows; defaults to {@link systemClock}. */
    clock?: Clock;
  };
  /** Default options applied to every {@link JwtService.sign} call. */
  jwtOptions?: JwtOptions;
}

/** Why a {@link DatingAuthService.login} attempt did not yield a token. */
export type LoginFailureReason = AbuseReason | 'INVALID_CREDENTIALS';

/** Parameters for a single login attempt. */
export interface LoginParams {
  /** Source IP of the attempt. */
  ip: string;
  /** Account being authenticated. */
  accountId: string;
  /**
   * The already-decided credential outcome. This package performs no credential
   * verification of its own — the caller supplies the result of comparing the
   * presented secret against the stored hash.
   */
  credentialsValid: boolean;
  /** Attempt timestamp (ms); defaults to the configured clock. */
  ts?: number;
  /** JWT claims to embed on success (`sub` defaults to `accountId`). */
  payload?: Partial<JwtPayload>;
  /** Session data to seal on success (`userId` defaults to `accountId`). */
  session?: SessionData;
}

/** Outcome of a login attempt. */
export interface LoginResult {
  /** Whether a token + session were issued. */
  ok: boolean;
  /** Signed JWT, present only when `ok` is true. */
  token?: string;
  /** Sealed (AES-256-GCM) session blob, present only when `ok` is true. */
  session?: string;
  /** Why issuance was refused, when `ok` is false. */
  reason?: LoginFailureReason;
  /** The structured decision returned by the core {@link AbuseEngine}. */
  decision: AbuseDecision;
}

/**
 * Dating authentication facade composing the three core primitives. It holds no
 * cryptographic material or counters of its own — all of that lives in the
 * wrapped {@link JwtService}, {@link SessionManager}, and {@link AbuseEngine}.
 */
export class DatingAuthService {
  private readonly jwt: JwtService;
  private readonly sessions: SessionManager;
  private readonly abuse: AbuseEngine;
  private readonly clock: Clock;
  private readonly jwtOptions: JwtOptions;

  constructor(opts: DatingAuthOptions) {
    this.clock = opts.abuse.clock ?? systemClock;
    this.jwtOptions = opts.jwtOptions ?? {};
    // Each primitive validates its own inputs and owns its logic.
    this.jwt = new JwtService(opts.jwtSecret);
    this.sessions = new SessionManager(opts.sessionKey);
    const store = opts.abuse.store ?? new InMemoryCounterStore({ clock: this.clock });
    this.abuse = new AbuseEngine(opts.abuse.config, store, opts.abuse.ipReputation, {
      clock: this.clock,
    });
  }

  /**
   * Orchestrate a login attempt (R11.7). The flow is:
   *   1. Record the attempt with the core {@link AbuseEngine}.
   *   2. If the engine refuses (lockout / score), return its decision.
   *   3. If credentials are invalid, return without issuing anything.
   *   4. Otherwise mint a JWT and seal a session via the core primitives.
   */
  async login(params: LoginParams): Promise<LoginResult> {
    const ts = params.ts ?? this.clock();
    const decision = await this.abuse.recordLoginAttempt({
      ip: params.ip,
      accountId: params.accountId,
      failed: !params.credentialsValid,
      ts,
    });

    if (!decision.allowed) {
      return { ok: false, reason: decision.reason, decision };
    }

    if (!params.credentialsValid) {
      return { ok: false, reason: 'INVALID_CREDENTIALS', decision };
    }

    const token = this.issueToken({ sub: params.accountId, ...params.payload });
    const session = this.createSession({ userId: params.accountId, ...params.session });
    return { ok: true, token, session, decision };
  }

  /** Record a signup attempt and return the core engine's throttling decision (R7.3). */
  signup(ip: string, ts: number = this.clock()): Promise<AbuseDecision> {
    return this.abuse.recordSignupAttempt(ip, ts);
  }

  /** Whether an account is currently locked out, per the core engine (R7.2). */
  isLockedOut(accountId: string, now: number = this.clock()): Promise<boolean> {
    return this.abuse.isLockedOut(accountId, now);
  }

  /** Sign a JWT by delegating to the wrapped {@link JwtService}. */
  issueToken(payload: JwtPayload, options?: JwtOptions): string {
    return this.jwt.sign(payload, options ?? this.jwtOptions);
  }

  /** Verify a JWT by delegating to the wrapped {@link JwtService}. */
  verifyToken(token: string, options?: JwtOptions): JwtPayload | null {
    return this.jwt.verify(token, options ?? this.jwtOptions);
  }

  /** Seal session data by delegating to the wrapped {@link SessionManager}. */
  createSession(data: SessionData): string {
    return this.sessions.encrypt(data);
  }

  /** Open a sealed session blob by delegating to the wrapped {@link SessionManager}. */
  readSession(blob: string): SessionData | null {
    return this.sessions.decrypt(blob);
  }

  /** CSRF token generator (delegates to the core {@link SessionManager}). */
  static generateCsrf(): string {
    return SessionManager.generateCsrf();
  }

  /** Session-id generator (delegates to the core {@link SessionManager}). */
  static generateSessionId(): string {
    return SessionManager.generateSessionId();
  }
}
