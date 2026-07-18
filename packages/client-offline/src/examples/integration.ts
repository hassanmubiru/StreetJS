/**
 * @streetjs/client-offline — runnable integration example.
 *
 * Simulates an app going offline and back online: reads are served stale from
 * the cache while offline, writes queue in an outbox, and everything flushes in
 * order once connectivity returns. Deterministic via an injected clock.
 *
 * Run with: `npm run example -w packages/client-offline`
 */

import { OfflineCache, MutationQueue, type Mutation, type SendOutcome } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

let t = 0;
const clock = () => t;
let online = true;

const cache = new OfflineCache({ clock, defaultTtlMs: 1000 });
const outbox = new MutationQueue({ clock });

// A "server" fetch/send that fails while offline.
const fetchProfile = async () => {
  if (!online) throw new Error('network down');
  return { name: 'Ada', seq: t };
};
const sent: string[] = [];
const send = async (m: Mutation): Promise<SendOutcome> => {
  if (!online) return { status: 'retry', error: 'offline' };
  sent.push(m.id);
  return { status: 'ok' };
};

// 1. Online: prime the cache.
const first = await cache.get('profile', fetchProfile);
console.log('online read:', first);
assert(first.name === 'Ada', 'fetched while online');

// 2. Go offline; the cached value expires but is served stale on fetch failure.
online = false;
t += 5000; // past TTL
const stale = await cache.get('profile', fetchProfile);
console.log('offline read (stale):', stale);
assert(stale.name === 'Ada', 'stale value served offline');

// 3. Queue writes while offline; flushing does nothing yet.
await outbox.enqueue({ id: 'w1', op: 'updateName', payload: { name: 'Ada L.' } });
await outbox.enqueue({ id: 'w2', op: 'addPost', payload: { text: 'hi' } });
let res = await outbox.flush(send);
console.log('flush while offline:', res, '· queued:', await outbox.size());
assert(res.sent === 0 && (await outbox.size()) === 2, 'nothing sent offline');

// 4. Back online: the outbox drains in order.
online = true;
res = await outbox.flush(send);
console.log('flush when online:', res, '· sent order:', sent);
assert(res.sent === 2 && (await outbox.size()) === 0, 'outbox drained');
assert(sent.join(',') === 'w1,w2', 'FIFO order preserved');

console.log('\nAll @streetjs/client-offline example assertions passed.');
