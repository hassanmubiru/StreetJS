// src/testing/chaos.ts
// Fault-injection / chaos-testing toolkit for verifying resilience (retries,
// backoff, circuit breakers, graceful degradation) deterministically. A seeded
// PRNG makes probabilistic faults reproducible in tests. Dependency-free.

import { ServiceUnavailableException } from '../http/exceptions.js';
import type { MiddlewareFn } from '../core/types.js';

/** Deterministic PRNG (mulberry32) so seeded chaos is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class InjectedFaultError extends Error {
  constructor(message = 'Injected fault') { super(message); this.name = 'InjectedFaultError'; }
}

export interface FaultPolicy {
  /** Probability [0,1] that a call fails. Default 0. */
  errorRate?: number;
  /** Fixed latency (ms) added before each call resolves. Default 0. */
  latencyMs?: number;
  /** Begin failing only after this many calls have been made. */
  failAfter?: number;
  /** Deterministically fail every Nth call (1-based). */
  failEvery?: number;
  /** Seed for the probabilistic error-rate decisions. Default 1. */
  seed?: number;
  /** Error factory for injected failures. Default throws InjectedFaultError. */
  error?: () => Error;
}

/**
 * Injects configured faults (latency, probabilistic errors, fail-after-N,
 * fail-every-N) into async operations. Counts every attempt so policies are
 * applied consistently; with a fixed `seed`, error-rate decisions are
 * reproducible.
 */
export class FaultInjector {
  private calls = 0;
  private readonly rand: () => number;
  private readonly policy: Required<Pick<FaultPolicy, 'errorRate' | 'latencyMs'>> & FaultPolicy;

  constructor(policy: FaultPolicy = {}) {
    this.rand = mulberry32(policy.seed ?? 1);
    this.policy = { errorRate: policy.errorRate ?? 0, latencyMs: policy.latencyMs ?? 0, ...policy };
  }

  /** Number of attempts observed so far. */
  get callCount(): number { return this.calls; }

  /** Decide whether the current (already-incremented) call should fail. */
  private shouldFail(): boolean {
    const n = this.calls;
    if (this.policy.failEvery && n % this.policy.failEvery === 0) return true;
    if (this.policy.failAfter !== undefined && n > this.policy.failAfter) return true;
    if (this.policy.errorRate > 0 && this.rand() < this.policy.errorRate) return true;
    return false;
  }

  /** Run an operation under the fault policy: optional latency, then maybe throw. */
  async run<T>(op: () => Promise<T> | T): Promise<T> {
    this.calls++;
    if (this.policy.latencyMs > 0) await new Promise((r) => setTimeout(r, this.policy.latencyMs));
    if (this.shouldFail()) {
      throw this.policy.error ? this.policy.error() : new InjectedFaultError(`fault on call ${this.calls}`);
    }
    return op();
  }

  /** Wrap a function so every invocation runs under {@link run}. */
  wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R> | R): (...args: A) => Promise<R> {
    return (...args: A) => this.run(() => fn(...args));
  }

  /** Reset the call counter (PRNG state is preserved). */
  reset(): void { this.calls = 0; }
}

/**
 * HTTP chaos middleware: injects latency and synthetic `503` responses
 * (via {@link ServiceUnavailableException}) according to the policy, so you can
 * exercise client retry/timeout behaviour against a live server.
 */
export function chaosMiddleware(policy: FaultPolicy = {}): MiddlewareFn {
  const injector = new FaultInjector(policy);
  return async (_ctx, next) => {
    try {
      await injector.run(async () => undefined);
    } catch {
      throw new ServiceUnavailableException('Chaos: injected fault');
    }
    await next();
  };
}

/**
 * Retry an operation with exponential backoff. Provided as the resilience
 * counterpart to {@link FaultInjector} so tests can prove that injected faults
 * are survived. Returns the first success or throws the last error.
 */
export async function retryWithBackoff<T>(
  op: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 1;
  const max = opts.maxDelayMs ?? 1000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await op();
    } catch (e) {
      lastErr = e;
      if (attempt === retries) break;
      await new Promise((r) => setTimeout(r, Math.min(base * 2 ** attempt, max)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
