// src/microservices/circuit-breaker.ts
// Circuit breaker with Closed → Open → Half-Open state machine.
import { EventEmitter } from 'node:events';
export class CircuitOpenError extends Error {
    constructor(name) {
        super(`Circuit is open${name ? `: ${name}` : ''}`);
        this.name = 'CircuitOpenError';
    }
}
// ── CircuitBreaker ─────────────────────────────────────────────────────────────
export class CircuitBreaker extends EventEmitter {
    _state = 'closed';
    _failures = 0;
    _successesInHalfOpen = 0;
    _openedAt = 0;
    _failureThreshold;
    _successThreshold;
    _timeout;
    _name;
    constructor(opts = {}) {
        super();
        this._failureThreshold = opts.failureThreshold ?? 5;
        this._successThreshold = opts.successThreshold ?? 2;
        this._timeout = opts.timeout ?? 60_000;
        this._name = opts.name ?? 'unknown';
    }
    get state() {
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
    async execute(fn) {
        const currentState = this.state; // triggers auto-transition Open → Half-Open
        if (currentState === 'open') {
            throw new CircuitOpenError(this._name);
        }
        try {
            const result = await fn();
            this._onSuccess();
            return result;
        }
        catch (err) {
            this._onFailure();
            throw err;
        }
    }
    _onSuccess() {
        if (this._state === 'half-open') {
            this._successesInHalfOpen++;
            if (this._successesInHalfOpen >= this._successThreshold) {
                this._transitionTo('closed');
            }
        }
        else if (this._state === 'closed') {
            // Reset failure counter on success in closed state
            this._failures = 0;
        }
    }
    _onFailure() {
        if (this._state === 'half-open') {
            // Probe failed: go back to Open
            this._transitionTo('open');
        }
        else if (this._state === 'closed') {
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
    _transitionTo(next) {
        const prev = this._state;
        this._state = next;
        // Validate allowed transitions
        const allowed = {
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
        }
        else if (next === 'closed') {
            this._failures = 0;
            this._successesInHalfOpen = 0;
        }
        else if (next === 'half-open') {
            this._successesInHalfOpen = 0;
        }
        this.emit('stateChange', { from: prev, to: next });
    }
    /** Reset the circuit breaker to Closed state (for testing). */
    reset() {
        this._state = 'closed';
        this._failures = 0;
        this._successesInHalfOpen = 0;
        this._openedAt = 0;
    }
}
//# sourceMappingURL=circuit-breaker.js.map