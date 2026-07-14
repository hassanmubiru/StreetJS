/**
 * @streetjs/testing — the StreetJS testing foundation.
 *
 * Framework-agnostic test utilities: spies, a controllable fake clock, deferreds,
 * `waitFor`/`delay` async helpers, and a scripted fetch mock. Zero runtime
 * dependencies. Public API only.
 *
 * ```ts
 * import { spy, fakeClock, mockFetch, jsonResponse, waitFor } from '@streetjs/testing';
 *
 * const clock = fakeClock(1000);
 * const logger = createLogger({ clock: clock.fn });   // deterministic time
 *
 * const fetch = mockFetch([jsonResponse({ ok: true })]);
 * const api = createHttpClient({ fetch });            // no network
 *
 * const handler = spy();
 * emitter.on('event', handler);
 * await waitFor(() => handler.called);
 * ```
 */

export { spy } from './spy.js';
export { fakeClock } from './clock.js';
export { deferred, delay, waitFor } from './async.js';
export { mockFetch, jsonResponse, sequential, type FetchHandler } from './fetch-mock.js';
export { deepEqual } from './equal.js';

export type {
  Spy,
  SpyCall,
  FakeClock,
  Deferred,
  WaitForOptions,
  FetchCall,
  FetchMock,
} from './types.js';
