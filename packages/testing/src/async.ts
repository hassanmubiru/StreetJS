/**
 * Async testing helpers: deferred promises, delays, and polling.
 *
 * Depends on `types` only.
 */

import type { Deferred, WaitForOptions } from './types.js';

/** Create an externally-resolvable/rejectable promise. */
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Resolve after `ms` milliseconds (unref'd, so it never keeps the process alive). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof (t as { unref?: () => void }).unref === 'function') {
      (t as { unref: () => void }).unref();
    }
  });
}

/**
 * Poll `predicate` until it returns a truthy value (or a resolved truthy value),
 * then resolve with it. Rejects if the timeout elapses first.
 */
export async function waitFor<T>(
  predicate: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 1000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await predicate();
    if (value) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(options.message ?? `waitFor timed out after ${timeoutMs}ms`);
    }
    await delay(intervalMs);
  }
}
