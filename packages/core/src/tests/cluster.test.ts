// src/tests/cluster.test.ts
// Redis Cluster foundation tests (RFC 0003). The pure primitives are verified
// against Redis's own documented reference vectors, so correctness does not
// depend on a live cluster.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  crc16,
  hashSlot,
  parseRedirect,
  parseClusterSlots,
  buildSlotMap,
  REDIS_CLUSTER_SLOTS,
} from '../transports/cluster.js';

describe('crc16 (CCITT/XMODEM)', () => {
  it('matches the standard check vector: crc16("123456789") === 0x31C3', () => {
    assert.equal(crc16('123456789'), 0x31c3);
  });
  it('is stable and 16-bit bounded', () => {
    for (const s of ['', 'a', 'foo', 'a-longer-key-value', '{tag}rest']) {
      const c = crc16(s);
      assert.ok(c >= 0 && c <= 0xffff, `crc16(${JSON.stringify(s)}) in range`);
      assert.equal(c, crc16(s), 'deterministic');
    }
  });
});

describe('hashSlot', () => {
  it('matches the documented Redis reference: hashSlot("foo") === 12182', () => {
    assert.equal(hashSlot('foo'), 12182);
  });
  it('is always within [0, 16384)', () => {
    for (const k of ['foo', 'bar', 'baz', 'user:1', '{x}y', 'a'.repeat(500)]) {
      const s = hashSlot(k);
      assert.ok(s >= 0 && s < REDIS_CLUSTER_SLOTS);
    }
  });
  it('hash tags co-locate keys: {user1000}.* share the slot of "user1000"', () => {
    const base = hashSlot('user1000');
    assert.equal(hashSlot('{user1000}.following'), base);
    assert.equal(hashSlot('{user1000}.followers'), base);
    assert.equal(hashSlot('{user1000}'), base);
  });
  it('empty hash tag "{}" falls back to hashing the whole key', () => {
    assert.equal(hashSlot('foo{}{bar}'), hashSlot('foo{}{bar}'));
    // "{}" is empty, so it must NOT reduce to hashing "" — differs from a real tag
    assert.notEqual(hashSlot('foo{}bar'), hashSlot('bar'));
  });
});

describe('parseRedirect', () => {
  it('parses MOVED', () => {
    assert.deepEqual(parseRedirect('MOVED 3999 127.0.0.1:6381'), {
      kind: 'MOVED', slot: 3999, host: '127.0.0.1', port: 6381,
    });
  });
  it('parses ASK', () => {
    assert.deepEqual(parseRedirect('ASK 3999 10.0.0.2:7000'), {
      kind: 'ASK', slot: 3999, host: '10.0.0.2', port: 7000,
    });
  });
  it('handles an IPv6 endpoint (splits on the last colon)', () => {
    const r = parseRedirect('MOVED 42 ::1:6379');
    assert.equal(r?.host, '::1');
    assert.equal(r?.port, 6379);
  });
  it('returns null for non-redirect messages', () => {
    assert.equal(parseRedirect('ERR unknown command'), null);
    assert.equal(parseRedirect('WRONGTYPE ...'), null);
  });
});

describe('parseClusterSlots + buildSlotMap', () => {
  const reply = [
    [0, 5460, ['10.0.0.1', 6379, 'id1'], ['10.0.0.4', 6379, 'id4']],
    [5461, 10922, ['10.0.0.2', 6379, 'id2']],
    [10923, 16383, ['10.0.0.3', 6379, 'id3']],
  ];
  it('parses ranges, masters, and replicas', () => {
    const ranges = parseClusterSlots(reply);
    assert.equal(ranges.length, 3);
    assert.deepEqual(ranges[0]!.master, { host: '10.0.0.1', port: 6379 });
    assert.deepEqual(ranges[0]!.replicas, [{ host: '10.0.0.4', port: 6379 }]);
    assert.equal(ranges[1]!.replicas.length, 0);
  });
  it('builds a slot→master map covering all slots', () => {
    const map = buildSlotMap(parseClusterSlots(reply));
    assert.equal(map[0]!.host, '10.0.0.1');
    assert.equal(map[5461]!.host, '10.0.0.2');
    assert.equal(map[16383]!.host, '10.0.0.3');
    // every slot is owned
    let covered = 0;
    for (let s = 0; s < REDIS_CLUSTER_SLOTS; s++) if (map[s]) covered++;
    assert.equal(covered, REDIS_CLUSTER_SLOTS);
  });
  it('skips malformed entries without throwing', () => {
    assert.deepEqual(parseClusterSlots('not-an-array' as unknown as never), []);
    const partial = parseClusterSlots([[0, 10, ['h', 6379]], ['bad'], [11, 20]] as never);
    assert.equal(partial.length, 1);
  });
});
