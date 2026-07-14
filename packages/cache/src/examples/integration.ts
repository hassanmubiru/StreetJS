/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * A small read-through cache in front of a "slow" lookup, plus TTL expiry and
 * LRU eviction demonstrated with an injected clock.
 */

import { LruCache } from '../index.js';

async function main(): Promise<void> {
  let time = 0;
  const cache = new LruCache<string, string>({
    maxEntries: 2,
    ttlMs: 100,
    autoSweep: false,
    clock: () => time,
  });

  let dbHits = 0;
  const load = (id: string): string => {
    dbHits++;
    return `record:${id}`;
  };
  const readThrough = (id: string): string => {
    const hit = cache.get(id);
    if (hit !== undefined) {
      return hit;
    }
    const value = load(id);
    cache.set(id, value);
    return value;
  };

  readThrough('a');
  readThrough('a'); // cache hit — no new db hit
  process.stdout.write(`after 2 reads of 'a': dbHits=${dbHits} (expected 1)\n`);

  readThrough('b');
  readThrough('c'); // evicts LRU ('a')
  process.stdout.write(`has 'a' after eviction: ${cache.has('a')} (expected false)\n`);

  time = 1000; // advance past TTL
  process.stdout.write(`has 'c' after TTL expiry: ${cache.has('c')} (expected false)\n`);

  cache.destroy();
}

void main();
