/**
 * @streetjs/client-offline — offline-first primitives for StreetJS client apps.
 *
 * Two composable, transport-agnostic pieces backed by a pluggable
 * {@link OfflineStore} (in-memory by default; wrap localStorage/IndexedDB/
 * AsyncStorage for real persistence):
 *
 * - **`OfflineCache`** — read-through cache with per-entry TTL that returns a
 *   *stale* value when a fetch fails, so the UI always has data offline.
 * - **`MutationQueue`** — a durable, ordered outbox: enqueue mutations while
 *   offline and `flush(sender)` them in order when back online, with retry,
 *   attempt limits, and permanent-drop handling.
 *
 * Both are deterministic under an injected clock and have zero runtime
 * dependencies. They work in the browser, Node, and native runtimes.
 *
 * ```ts
 * import { OfflineCache, MutationQueue } from '@streetjs/client-offline';
 *
 * const cache = new OfflineCache({ defaultTtlMs: 60_000 });
 * const profile = await cache.get('me', () => api.get('/me')); // stale-on-error
 *
 * const outbox = new MutationQueue();
 * await outbox.enqueue({ id: crypto.randomUUID(), op: 'createPost', payload });
 * window.addEventListener('online', () => outbox.flush(send));
 * ```
 */

export { OfflineCache } from './cache.js';
export type { OfflineCacheOptions } from './cache.js';

export { MutationQueue } from './queue.js';
export type { MutationQueueOptions } from './queue.js';

export { MemoryOfflineStore } from './store.js';

export type {
  Clock,
  OfflineStore,
  Mutation,
  MutationSender,
  SendOutcome,
  FlushResult,
} from './types.js';
