// Temporary repro: replay the exact CI counterexample seed/path against the
// (patched) interchangeability property to confirm it now holds.
import fc from 'fast-check';
import { MemoryDriver } from './dist/drivers/memory.js';
import { RedisDriver } from './dist/drivers/redis.js';
import { SimulatedRedis } from './dist/tests/sim-redis.js';
import assert from 'node:assert/strict';

const QUEUES = ['qA', 'qB'];
const VISIBILITY_MS = 500;
const SERIALIZED_ERROR = { name: 'SimFailure', message: 'boom' };

function makeEnvelope(spec, seq) {
  return { id: `job-${seq}`, type: 'sim-job', queue: QUEUES[spec.queueIndex], payload: { n: seq }, priority: spec.priority, attempts: 0, maxAttempts: spec.maxAttempts, enqueuedAt: 0, seq };
}
function dlqKey(r) { return `${r.id}|${r.queue}|${r.type}|${r.attempts}/${r.maxAttempts}`; }

const jobSpecArb = fc.record({
  queueIndex: fc.integer({ min: 0, max: 1 }),
  priority: fc.integer({ min: -3, max: 3 }),
  maxAttempts: fc.integer({ min: 1, max: 3 }),
  delayMs: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 300 })),
});
const opArb = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('reserve') }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('ack'), idx: fc.nat({ max: 1000 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('nack'), idx: fc.nat({ max: 1000 }), delayMs: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 300 })) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('deadletter'), idx: fc.nat({ max: 1000 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('promote') }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('advance'), ms: fc.integer({ min: 1, max: 700 }) }) },
);

async function body(specs, ops) {
  const mem = new MemoryDriver();
  const redis = new RedisDriver({ client: new SimulatedRedis(), keyPrefix: 'sim', visibilityMs: VISIBILITY_MS });
  await mem.init(); await redis.init();
  try {
    for (let seq = 0; seq < specs.length; seq += 1) {
      const spec = specs[seq]; const queue = QUEUES[spec.queueIndex];
      if (spec.delayMs > 0) { await mem.enqueueDelayed(queue, makeEnvelope(spec, seq), spec.delayMs); await redis.enqueueDelayed(queue, makeEnvelope(spec, seq), spec.delayMs); }
      else { await mem.enqueue(queue, makeEnvelope(spec, seq)); await redis.enqueue(queue, makeEnvelope(spec, seq)); }
    }
    const queues = [...QUEUES]; const held = []; let now = 0;
    const activeHoldings = (nowTs) => held.filter((h) => !h.resolved && !h.superseded && h.mem.leaseExpiresAt > nowTs);
    for (const op of ops) {
      switch (op.kind) {
        case 'reserve': {
          const rMem = await mem.reserve(queues, VISIBILITY_MS, now);
          const rRedis = await redis.reserve(queues, VISIBILITY_MS, now);
          assert.equal(rMem === null, rRedis === null);
          if (rMem !== null && rRedis !== null) {
            assert.equal(rMem.envelope.id, rRedis.envelope.id);
            assert.equal(rMem.envelope.attempts, rRedis.envelope.attempts);
            for (const h of held) if (!h.resolved && h.id === rMem.envelope.id) h.superseded = true;
            held.push({ id: rMem.envelope.id, mem: rMem, redis: rRedis, superseded: false, resolved: false });
          }
          break;
        }
        case 'ack': { const c = activeHoldings(now); if (!c.length) break; const ch = c[op.idx % c.length]; await mem.ack(ch.mem); await redis.ack(ch.redis); ch.resolved = true; break; }
        case 'nack': { const c = activeHoldings(now); if (!c.length) break; const ch = c[op.idx % c.length]; const runAt = op.delayMs > 0 ? now + op.delayMs : undefined; await mem.nack(ch.mem, runAt); await redis.nack(ch.redis, runAt); ch.resolved = true; break; }
        case 'deadletter': { const c = activeHoldings(now); if (!c.length) break; const ch = c[op.idx % c.length]; await mem.moveToDeadLetter(ch.mem, SERIALIZED_ERROR); await redis.moveToDeadLetter(ch.redis, SERIALIZED_ERROR); ch.resolved = true; break; }
        case 'promote': { const pMem = await mem.promoteDue(now); const pRedis = await redis.promoteDue(now); assert.equal(pMem, pRedis); break; }
        case 'advance': { now += op.ms; break; }
      }
    }
    const sMem = await mem.stats(); const sRedis = await redis.stats(); assert.deepEqual(sRedis, sMem);
    const dMem = (await mem.listDeadLetters(undefined, -1)).map(dlqKey).sort();
    const dRedis = (await redis.listDeadLetters(undefined, -1)).map(dlqKey).sort();
    assert.deepEqual(dRedis, dMem);
  } finally { await mem.close(); await redis.close(); }
}

const r = await fc.check(fc.asyncProperty(fc.array(jobSpecArb, { minLength: 1, maxLength: 12 }), fc.array(opArb, { minLength: 1, maxLength: 60 }), body), { seed: 108598956, path: '77:1:1:1:10:12:12:9:9:9:10:15:15:15', endOnFailure: true });
console.log('exact counterexample replay failed?', r.failed);
if (r.failed) { console.error(r.counterexample); process.exit(1); }

// Also run a broad sweep across many fresh seeds.
await fc.assert(fc.asyncProperty(fc.array(jobSpecArb, { minLength: 1, maxLength: 12 }), fc.array(opArb, { minLength: 1, maxLength: 60 }), body), { numRuns: 3000 });
console.log('3000-run sweep passed');
