/**
 * Bounded execution of a check via a timeout.
 *
 * Leaf module — no internal imports.
 */

/** Raised when a check does not settle within its timeout. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/**
 * Resolve/reject with `promise`, or reject with {@link TimeoutError} after `ms`.
 * The timer is unref'd so a pending check cannot keep the process alive.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Not unref'd: this bounded timer must fire to enforce the timeout, and it
    // is always cleared once the wrapped promise settles first.
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
