import { test } from 'node:test';
import assert from 'node:assert/strict';

import { spy } from '../spy.js';

test('records calls, count, and called flag', () => {
  const s = spy();
  assert.equal(s.called, false);
  s(1, 2);
  s('x');
  assert.equal(s.callCount, 2);
  assert.equal(s.called, true);
  assert.deepEqual(s.calls[0].args, [1, 2]);
  assert.deepEqual(s.lastCall?.args, ['x']);
});

test('default spy returns undefined; impl is invoked and recorded', () => {
  const plain = spy();
  assert.equal(plain(), undefined);
  const s = spy((a, b) => (a as number) + (b as number));
  assert.equal(s(2, 3), 5);
  assert.equal(s.lastCall?.returned, 5);
});

test('records thrown errors and rethrows', () => {
  const s = spy(() => {
    throw new Error('boom');
  });
  assert.throws(() => s());
  assert.equal((s.lastCall?.threw as Error).message, 'boom');
});

test('calledWith matches by deep equality', () => {
  const s = spy();
  s({ a: 1, nested: [1, 2] });
  assert.equal(s.calledWith({ a: 1, nested: [1, 2] }), true);
  assert.equal(s.calledWith({ a: 2 }), false);
});

test('mockReturnValue and mockImplementation configure behavior', () => {
  const s = spy();
  s.mockReturnValue(42);
  assert.equal(s(), 42);
  s.mockImplementation((n) => (n as number) * 2);
  assert.equal(s(10), 20);
});

test('mockResolvedValue and mockRejectedValue return promises', async () => {
  const ok = spy().mockResolvedValue('done');
  assert.equal(await (ok() as Promise<string>), 'done');
  const bad = spy().mockRejectedValue(new Error('nope'));
  await assert.rejects(bad() as Promise<unknown>, /nope/);
});

test('reset clears calls but keeps implementation', () => {
  const s = spy().mockReturnValue(7);
  s();
  s.reset();
  assert.equal(s.callCount, 0);
  assert.equal(s(), 7);
});
