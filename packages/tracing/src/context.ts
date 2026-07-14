/**
 * Async context propagation for the active span, backed by AsyncLocalStorage.
 *
 * Depends on `node:async_hooks` and `types`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Span } from './types.js';

const storage = new AsyncLocalStorage<Span>();

/** The span active on the current async execution path, if any. */
export function activeSpan(): Span | undefined {
  return storage.getStore();
}

/** Run `fn` with `span` set as the active span for its (async) duration. */
export function withActiveSpan<T>(span: Span, fn: () => T): T {
  return storage.run(span, fn);
}
