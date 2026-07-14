import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Counter } from '../counter.js';

test('unlabeled counter increments by 1 and by explicit amounts', () => {
  const c = new Counter({ name: 'jobs_total', help: 'jobs' });
  c.inc();
  c.inc(4);
  assert.equal(c.value(), 5);
});

test('labeled counter tracks independent series', () => {
  const c = new Counter({ name: 'http_requests_total', help: 'reqs', labelNames: ['method'] });
  c.inc({ method: 'GET' });
  c.inc({ method: 'GET' }, 2);
  c.inc({ method: 'POST' });
  assert.equal(c.value({ method: 'GET' }), 3);
  assert.equal(c.value({ method: 'POST' }), 1);
});

test('label order does not create distinct series', () => {
  const c = new Counter({ name: 'x_total', help: 'x', labelNames: ['a', 'b'] });
  c.inc({ a: '1', b: '2' });
  c.inc({ b: '2', a: '1' });
  assert.equal(c.value({ a: '1', b: '2' }), 2);
});

test('negative increment is rejected', () => {
  const c = new Counter({ name: 'n_total', help: 'n' });
  assert.throws(() => c.inc(-1), /negative/);
});

test('missing or extra labels are rejected', () => {
  const c = new Counter({ name: 'l_total', help: 'l', labelNames: ['a'] });
  assert.throws(() => c.inc({} as never), /Expected labels/);
  assert.throws(() => c.inc({ a: '1', b: '2' } as never), /Expected labels/);
});

test('value of an unseen series is 0', () => {
  const c = new Counter({ name: 'z_total', help: 'z', labelNames: ['k'] });
  assert.equal(c.value({ k: 'nope' }), 0);
});

test('reset clears all series', () => {
  const c = new Counter({ name: 'r_total', help: 'r' });
  c.inc(3);
  c.reset();
  assert.equal(c.value(), 0);
});

test('collect returns one sample per series', () => {
  const c = new Counter({ name: 'c_total', help: 'c', labelNames: ['s'] });
  c.inc({ s: 'a' }, 2);
  c.inc({ s: 'b' });
  const snap = c.collect();
  assert.equal(snap.type, 'counter');
  assert.equal(snap.samples.length, 2);
  const a = snap.samples.find((x) => x.labels.s === 'a');
  assert.equal(a?.value, 2);
});

test('numeric and boolean label values are coerced to strings', () => {
  const c = new Counter({ name: 'co_total', help: 'co', labelNames: ['code', 'ok'] });
  c.inc({ code: 200, ok: true });
  const snap = c.collect();
  assert.equal(snap.samples[0].labels.code, '200');
  assert.equal(snap.samples[0].labels.ok, 'true');
});
