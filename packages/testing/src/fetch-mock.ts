/**
 * A `fetch`-compatible mock for testing HTTP consumers without a network.
 *
 * Depends on `types` only (uses the global `Response`).
 */

import type { FetchCall, FetchMock } from './types.js';

/** A handler that produces a response for a recorded call. */
export type FetchHandler = (call: FetchCall) => Response | Promise<Response>;

/** Build a JSON `Response`. */
export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * Turn a list of responses (or per-call handlers) into a handler that returns
 * each in turn, repeating the last once exhausted.
 */
export function sequential(responses: Array<Response | FetchHandler>): FetchHandler {
  let i = 0;
  return (call) => {
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return typeof next === 'function' ? next(call) : next;
  };
}

/**
 * Create a recording `fetch` mock. Pass a handler function, a single `Response`,
 * or an array of responses/handlers (served in sequence).
 */
export function mockFetch(handler: FetchHandler | Response | Array<Response | FetchHandler>): FetchMock {
  const resolve: FetchHandler = Array.isArray(handler)
    ? sequential(handler)
    : typeof handler === 'function'
      ? handler
      : (): Response => handler.clone();

  const calls: FetchCall[] = [];

  const fn = (async (input: string, init: RequestInit = {}): Promise<Response> => {
    const call: FetchCall = { url: input, init };
    calls.push(call);
    return resolve(call);
  }) as FetchMock;

  Object.defineProperty(fn, 'calls', { get: () => calls });
  fn.reset = (): void => {
    calls.length = 0;
  };

  return fn;
}
