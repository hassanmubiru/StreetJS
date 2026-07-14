import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Histogram, DEFAULT_BUCKETS } from '../histogram.js';

function bucketValue(samples: readonly { name: string; labels: Record<string, string>; value: number }[], le: string): number {
  const s = samples.find((x) => x.name.endsWith('_bucket') && x.labels.le === le);
  return s?.value ?? -1;
}

test('observations fill cumulative buckets plus sum and count', () => {
  const h = new Histogram({ name: 'lat', help: 'latency', buckets: [0.1, 0.5, 1] });
  h.observe(0.05);
  h.observe(0.3);
  h.observe(2);
  const { samples } = h.collect();
  assert.equal(bucketValue(samples, '0.1'), 1); // only 0.05
  assert.equal(bucketValue(samples, '0.5'), 2); // 0.05, 0.3
  assert.equal(bucketValue(samples, '1'), 2);
  assert.equal(bucketValue(samples, '+Inf'), 3);
  const sum = samples.find((s) => s.name === 'lat_sum');
  const count = samples.find((s) => s.name === 'lat_count');
  assert.equal(sum?.value, 2.35);
  assert.equal(count?.value, 3);
});

test('default buckets are used when none are supplied', () => {
  const h = new Histogram({ name: 'd', help: 'd' });
  assert.deepEqual(h.buckets, DEFAULT_BUCKETS);
});

test('labeled histogram keeps independent series', () => {
  const h = new Histogram({ name: 'req', help: 'r', labelNames: ['route'], buckets: [1] });
  h.observe({ route: '/a' }, 0.5);
  h.observe({ route: '/b' }, 5);
  const { samples } = h.collect();
  const aInf = samples.find((s) => s.labels.route === '/a' && s.labels.le === '+Inf');
  const bBucket = samples.find(
    (s) => s.labels.route === '/b' && s.labels.le === '1' && s.name === 'req_bucket',
  );
  assert.equal(aInf?.value, 1);
  assert.equal(bBucket?.value, 0);
});

test('startTimer observes elapsed seconds', () => {
  let now = 0;
  const h = new Histogram({ name: 't', help: 't', buckets: [1, 5] }, () => now);
  const done = h.startTimer();
  now = 2000;
  const seconds = done();
  assert.equal(seconds, 2);
  const { samples } = h.collect();
  assert.equal(samples.find((s) => s.name === 't_count')?.value, 1);
  assert.equal(bucketValue(samples, '5'), 1);
  assert.equal(bucketValue(samples, '1'), 0);
});

test('observe requires a numeric value when labels are given', () => {
  const h = new Histogram({ name: 'x', help: 'x', labelNames: ['k'], buckets: [1] });
  assert.throws(() => h.observe({ k: 'a' }), /requires a numeric value/);
});

test('non-finite observations are rejected', () => {
  const h = new Histogram({ name: 'nf', help: 'nf', buckets: [1] });
  assert.throws(() => h.observe(Infinity), /non-finite/);
});

test('invalid bucket definitions are rejected', () => {
  assert.throws(() => new Histogram({ name: 'a', help: 'a', buckets: [] }), /at least one bucket/);
  assert.throws(
    () => new Histogram({ name: 'b', help: 'b', buckets: [1, 1] }),
    /strictly increasing/,
  );
  assert.throws(
    () => new Histogram({ name: 'c', help: 'c', buckets: [2, 1] }),
    /strictly increasing/,
  );
  assert.throws(
    () => new Histogram({ name: 'd', help: 'd', buckets: [Infinity] }),
    /finite numbers/,
  );
});

test('the reserved le label is rejected', () => {
  assert.throws(
    () => new Histogram({ name: 'e', help: 'e', labelNames: ['le'] }),
    /reserved label "le"/,
  );
});

test('reset clears observations', () => {
  const h = new Histogram({ name: 'r', help: 'r', buckets: [1] });
  h.observe(0.5);
  h.reset();
  assert.equal(h.collect().samples.length, 0);
});
