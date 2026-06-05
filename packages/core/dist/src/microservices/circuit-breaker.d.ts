import { EventEmitter } from 'node:events';
export type CircuitState = 'closed' | 'open' | 'half-open';
export declare class CircuitOpenError extends Error {
    constructor(name?: string);
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
export declare class CircuitBreaker extends EventEmitter {
    private _state;
    private _failures;
    private _successesInHalfOpen;
    private _openedAt;
    private readonly _failureThreshold;
    private readonly _successThreshold;
    private readonly _timeout;
    private readonly _name;
    constructor(opts?: CircuitBreakerOptions);
    get state(): CircuitState;
    /**
     * Execute a function through the circuit breaker.
     * - In Closed state: runs fn(), records successes/failures.
     * - In Open state: throws CircuitOpenError immediately.
     * - In Half-Open state: runs fn() as a probe.
     */
    execute<T>(fn: () => Promise<T>): Promise<T>;
    private _onSuccess;
    private _onFailure;
    private _transitionTo;
    /** Reset the circuit breaker to Closed state (for testing). */
    reset(): void;
}
//# sourceMappingURL=circuit-breaker.d.ts.map