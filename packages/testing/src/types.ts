/**
 * Public types for @streetjs/testing.
 */

/** A record of one spy invocation. */
export interface SpyCall {
  /** Arguments the spy was called with. */
  readonly args: unknown[];
  /** Return value, when the call returned normally. */
  readonly returned?: unknown;
  /** Thrown value, when the call threw. */
  readonly threw?: unknown;
}

/** A recording test double. Callable, with inspection and configuration helpers. */
export interface Spy {
  (...args: unknown[]): unknown;
  /** All recorded calls, in order. */
  readonly calls: readonly SpyCall[];
  /** Number of times the spy was called. */
  readonly callCount: number;
  /** True when the spy has been called at least once. */
  readonly called: boolean;
  /** The most recent call, or `undefined`. */
  readonly lastCall: SpyCall | undefined;
  /** True when any call matched exactly these arguments (deep-equal). */
  calledWith(...args: unknown[]): boolean;
  /** Replace the implementation. */
  mockImplementation(impl: (...args: unknown[]) => unknown): Spy;
  /** Return a fixed value on every call. */
  mockReturnValue(value: unknown): Spy;
  /** Return a promise resolving to `value` on every call. */
  mockResolvedValue(value: unknown): Spy;
  /** Return a promise rejecting with `error` on every call. */
  mockRejectedValue(error: unknown): Spy;
  /** Clear recorded calls (keeps the current implementation). */
  reset(): void;
}

/** A controllable clock. `now`/`fn` return epoch milliseconds. */
export interface FakeClock {
  /** Current time in epoch ms. */
  now(): number;
  /** The clock as a `() => number` function, for packages that accept a clock. */
  readonly fn: () => number;
  /** Advance time by `ms`. */
  tick(ms: number): void;
  /** Set the absolute time (epoch ms). */
  set(ms: number): void;
}

/** A resolvable/rejectable promise handle. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
}

/** Options for {@link waitFor}. */
export interface WaitForOptions {
  /** Give up after this many ms. Default `1000`. */
  readonly timeoutMs?: number;
  /** Poll interval in ms. Default `10`. */
  readonly intervalMs?: number;
  /** Message used in the timeout error. */
  readonly message?: string;
}

/** A recorded fetch invocation. */
export interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

/** A `fetch`-compatible mock with call recording. */
export interface FetchMock {
  (input: string, init?: RequestInit): Promise<Response>;
  /** All recorded calls, in order. */
  readonly calls: readonly FetchCall[];
  /** Clear recorded calls. */
  reset(): void;
}
