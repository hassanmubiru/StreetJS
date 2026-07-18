# @streetjs/client-offline

Offline-first primitives for StreetJS client apps: a **read-through cache** (with
TTL and stale-on-error) and a **durable, ordered mutation outbox** (enqueue while
offline, flush when online with retry/backoff). Transport-agnostic and
storage-pluggable. **Zero runtime dependencies**; works in the browser, Node, and
native runtimes (React/Tauri/extension/mobile).

## Install

```bash
npm install @streetjs/client-offline
```

## Cache (stale-while-offline reads)

```ts
import { OfflineCache } from '@streetjs/client-offline';

const cache = new OfflineCache({ defaultTtlMs: 60_000 });

// Fresh within TTL → cached; expired → refetch; fetch fails → serve the stale value.
const me = await cache.get('me', () => client.get('/me'));

await cache.set('flags', flags, 5 * 60_000);
await cache.peek('flags');       // fresh value or undefined (respects expiry)
await cache.invalidate('me');
```

## Outbox (queue writes offline, flush online)

```ts
import { MutationQueue, type SendOutcome } from '@streetjs/client-offline';

const outbox = new MutationQueue({ maxAttempts: 8 });

await outbox.enqueue({ id: crypto.randomUUID(), op: 'createPost', payload });

const send = async (m): Promise<SendOutcome> => {
  const res = await client.post(`/rpc/${m.op}`, m.payload).catch(() => null);
  if (!res) return { status: 'retry' };          // transient → keep & retry
  if (res.status >= 400 && res.status < 500) return { status: 'drop', error: `${res.status}` };
  return { status: 'ok' };
};

window.addEventListener('online', () => outbox.flush(send));
```

- **FIFO + ordering-safe** — `flush` replays in insertion order and stops at the
  first transient failure so later mutations never overtake an earlier one.
- **Retry / drop** — a `retry` keeps the mutation (incrementing `attempts`); a
  `drop` (or exceeding `maxAttempts`) removes it and fires `onDrop`.
- **De-duplicated** by `id`, **persisted** on every change, and **re-entrancy
  guarded** so overlapping flushes don't double-send.

## Storage

Both use a pluggable `OfflineStore` (`get`/`set`/`delete`/`keys`). The default is
`MemoryOfflineStore`; wrap `localStorage`, IndexedDB, or React-Native
`AsyncStorage` behind the same interface for real persistence:

```ts
class LocalStorageStore implements OfflineStore {
  async get(k){ return localStorage.getItem(k) ?? undefined; }
  async set(k,v){ localStorage.setItem(k,v); }
  async delete(k){ localStorage.removeItem(k); }
  async keys(){ return Object.keys(localStorage); }
}
new OfflineCache({ store: new LocalStorageStore() });
```

An injectable `clock` makes TTL/queue timing fully deterministic in tests.

## Example

A complete runnable example (simulating offline → online) lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/client-offline
```

## License

MIT — see [LICENSE](./LICENSE).
