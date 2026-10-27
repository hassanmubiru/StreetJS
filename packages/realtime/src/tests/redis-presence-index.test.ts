import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RedisAdapter } from '../cluster/redis.js';

class FakeRedis {
  readonly sets = new Map<string, Set<string>>();
  readonly commands: (string | number)[][] = [];

  async command(args: (string | number)[]): Promise<unknown> {
    this.commands.push(args);
    const [rawCommand, rawKey, rawMember] = args;
    const command = String(rawCommand).toUpperCase();
    const key = String(rawKey);
    if (command === 'SADD') {
      let set = this.sets.get(key);
      if (!set) {
        set = new Set();
        this.sets.set(key, set);
      }
      const before = set.size;
      set.add(String(rawMember));
      return set.size === before ? 0 : 1;
    }
    if (command === 'SREM') {
      const set = this.sets.get(key);
      if (!set) return 0;
      const removed = set.delete(String(rawMember)) ? 1 : 0;
      if (set.size === 0) this.sets.delete(key);
      return removed;
    }
    if (command === 'SCARD') return this.sets.get(key)?.size ?? 0;
    if (command === 'SMEMBERS') return [...(this.sets.get(key) ?? [])];
    if (command === 'PEXPIRE') return 1;
    throw new Error(`Unexpected Redis command: ${command}`);
  }

  async publish(): Promise<void> {}

  async subscribe(): Promise<() => void> {
    return () => {};
  }
}

test('RedisAdapter indexes presence by channel without a blocking KEYS scan', async () => {
  const client = new FakeRedis();
  const adapter = new RedisAdapter({ client, instanceId: 'gateway-a', presenceTtlMs: 60_000 });
  await adapter.init({ deliverLocal: () => {}, applyRemotePresence: () => {} });

  await adapter.publishPresence('match:1', 'alice', 'join');
  client.sets.set('streetjs:rt:presence-index:match:1', new Set(['gateway-a', 'gateway-b', 'dead-gateway']));
  client.sets.set('streetjs:rt:presence:match:1:gateway-b', new Set(['bob']));

  client.commands.length = 0;
  assert.deepEqual(await adapter.remotePresence('match:1'), ['bob']);
  assert.equal(client.commands.some(([command]) => String(command).toUpperCase() === 'KEYS'), false);
  assert.deepEqual([...client.sets.get('streetjs:rt:presence-index:match:1')!], ['gateway-a', 'gateway-b']);

  client.commands.length = 0;
  await (adapter as unknown as { refreshPresenceTtl(): Promise<void> }).refreshPresenceTtl();
  assert.equal(client.commands.some(([command, key]) => (
    String(command).toUpperCase() === 'PEXPIRE' && key === 'streetjs:rt:presence:match:1:gateway-a'
  )), true);

  await adapter.publishPresence('match:1', 'alice', 'leave');
  assert.equal(client.sets.has('streetjs:rt:presence-index:match:1'), true);
  assert.deepEqual([...client.sets.get('streetjs:rt:presence-index:match:1')!], ['gateway-b']);
  await adapter.close();
});
