/**
 * A recording test double (spy) with inspection and configuration.
 *
 * Depends on `types` and `equal`.
 */

import type { Spy, SpyCall } from './types.js';
import { deepEqual } from './equal.js';

/**
 * Create a spy. Optionally pass a default implementation; otherwise the spy
 * returns `undefined`. Configure behavior with `mock*` methods.
 */
export function spy(impl?: (...args: unknown[]) => unknown): Spy {
  const calls: SpyCall[] = [];
  let implementation: (...args: unknown[]) => unknown = impl ?? ((): unknown => undefined);

  const fn = ((...args: unknown[]): unknown => {
    try {
      const returned = implementation(...args);
      calls.push({ args, returned });
      return returned;
    } catch (error) {
      calls.push({ args, threw: error });
      throw error;
    }
  }) as Spy;

  Object.defineProperties(fn, {
    calls: { get: () => calls },
    callCount: { get: () => calls.length },
    called: { get: () => calls.length > 0 },
    lastCall: { get: () => calls[calls.length - 1] },
  });

  fn.calledWith = (...args: unknown[]): boolean =>
    calls.some((call) => deepEqual(call.args, args));

  fn.mockImplementation = (next: (...args: unknown[]) => unknown): Spy => {
    implementation = next;
    return fn;
  };
  fn.mockReturnValue = (value: unknown): Spy => {
    implementation = (): unknown => value;
    return fn;
  };
  fn.mockResolvedValue = (value: unknown): Spy => {
    implementation = (): unknown => Promise.resolve(value);
    return fn;
  };
  fn.mockRejectedValue = (error: unknown): Spy => {
    implementation = (): unknown => Promise.reject(error);
    return fn;
  };
  fn.reset = (): void => {
    calls.length = 0;
  };

  return fn;
}
