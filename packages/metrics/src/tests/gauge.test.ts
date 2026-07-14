import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Gauge } from '../gauge.js';

test('set, inc, and dec adjust the value', () => {
  const g = new Gauge({ name: 'in_flight', help: 'in flight' });
  g.set(10);
  g.inc();
  g.inc(4);
  g.dec(2);
  assert.equal(g.value(), 13);
});

test('inc/dec on an unseen series start from 0', () => {
  const g = new Gauge({ name: 'q_depth', help: 'q', labelNames: ['queue'] });
  g.inc({ queue: 'a' }, 3);
  g.dec({ queue: 'b' });
  assert.equal(g.value({ queue: 'a' }), 3);
  assert.equal(g.value({ queue: 'b' }), -1);
});

test('setToCurrentTime uses the injected clock (seconds)', () => {
  const g = new Gauge({ name: 'ts', help: 'ts' }, () => 5000);
  g.setToCurrentTime();
  assert.equal(g.value(), 5);
});

test('startTimer records elapsed seconds', () => {
  let now = 1000;
  const g = new Gauge({ name: 'last_duration_seconds', help: 'd' }, () => now);
  const done = g.startTimer();
  now = 3500;
  const seconds = done();
  assert.equal(seconds, 2.5);
  assert.equal(g.value(), 2.5);
});

test('startTimer supports labels', () => {
  let now = 0;
  const g = new Gauge({ name: 'ld', help: 'd', labelNames: ['op'] }, () => now);
  const done = g.startTimer({ op: 'sync' });
  now = 1000;
  done();
  assert.equal(g.value({ op: 'sync' }), 1);
});

test('reset clears series and collect reflects current values', () => {
  const g = new Gauge({ name: 'g', help: 'g', labelNames: ['k'] });
  g.set({ k: 'a' }, 7);
  const snap = g.collect();
  assert.equal(snap.type, 'gauge');
  assert.equal(snap.samples[0].value, 7);
  g.reset();
  assert.equal(g.collect().samples.length, 0);
});
