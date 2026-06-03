// src/microservices/circuit-breaker.ts
// Circuit breaker with Closed → Open → Half-Open state machine.

import { EventEmitter } from 'node:events';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitOpenError extends Error {
  constructor(name?: string) {
    super(`Circuit is open${name ? `: ${name}` : ''}`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5. */
  failureThreshold?: number;
  /** Number of consecutive successes in Half-Open required to close. Default: 2. */
  successThreshold?: number;
  /** Milliseconds to wait in Open state before transitioning to Half-Open. Default: 60000. */
  timeout?: number;
  /** Name of this circuit breaker (used in events and errors). */
  name?: string;
}

// ── CircuitBreaker ─────────────────────────────────────────────────────────────

export class CircuitBreaker extends EventEmitter {
  private _state: CircuitState = 'closed';
  private _failures = 0;
  private _successesInHalfOpen = 0;
  private _openedAt = 0;

  private readonly _failureThreshold: number;
  private readonly _successThreshold: number;
  private readonly _timeout: number;
  private readonly _name: string;

  constructor(opts: CircuitBreakerOptions = {}) {
    super();
    this._failureThreshold = opts.failureThreshold ?? 5;
    this._successThreshold = opts.successThreshold ?? 2;
    this._timeout = opts.timeout ?? 60_000;
    this._name = opts.name ?? 'unknown';
  }

  get state(): CircuitState {
    // Automatically transition from Open → Half-Open after timeout
    if (this._state === 'open' && Date.now() - this._openedAt >= this._timeout) {
      this._transitionTo('half-open');
    }
    return this._state;
  }

  /**
   * Execute a function through the circuit breaker.
   * - In Closed state: runs fn(), records successes/failures.
   * - In Open state: throws CircuitOpenError immediately.
   * - In Half-Open state: runs fn() as a probe.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state; // triggers auto-transition Open → Half-Open

    if (currentState === 'open') {
      throw new CircuitOpenError(this._name);
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  private _onSuccess(): void {
    if (this._state === 'half-open') {
      this._successesInHalfOpen++;
      if (this._successesInHalfOpen >= this._successThreshold) {
        this._transitionTo('closed');
      }
    } else if (this._state === 'closed') {
      // Reset failure counter on success in closed state
      this._failures = 0;
    }
  }

  private _onFailure(): void {
    if (this._state === 'half-open') {
      // Probe failed: go back to Open
      this._transitionTo('open');
    } else if (this._state === 'closed') {
      this._failures++;
      if (this._failures >= this._failureThreshold) {
        this._transitionTo('open');
        this.emit('circuitbreaker:open', {
          name: this._name,
          failures: this._failures,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private _transitionTo(next: CircuitState): void {
    const prev = this._state;
    this._state = next;

    // Validate allowed transitions
    const allowed: Record<CircuitState, CircuitState[]> = {
      closed: ['open'],
      open: ['half-open'],
      'half-open': ['closed', 'open'],
    };

    if (!allowed[prev]?.includes(next)) {
      // Should never happen via the public interface, but guard defensively
      this._state = prev; // revert
      throw new Error(`Invalid circuit state transition: ${prev} → ${next}`);
    }

    if (next === 'open') {
      this._openedAt = Date.now();
      this._successesInHalfOpen = 0;
    } else if (next === 'closed') {
      this._failures = 0;
      this._successesInHalfOpen = 0;
    } else if (next === 'half-open') {
      this._successesInHalfOpen = 0;
    }

    this.emit('stateChange', { from: prev, to: next });
  }

  /** Reset the circuit breaker to Closed state (for testing). */
  reset(): void {
    this._state = 'closed';
    this._failures = 0;
    this._successesInHalfOpen = 0;
    this._openedAt = 0;
  }
}
