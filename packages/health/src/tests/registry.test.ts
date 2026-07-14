import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HealthRegistry } from '../registry.js';
import { HEALTH_REGISTRY } from '../index.js';

function fixedClock(): () => number {
  let t = 1_000;
  return () => (t += 5);
}

test('a registry with no checks reports pass', async () => {
  const h = new HealthRegistry({ clock: fixedClock() });
  const report = await h.readiness();
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.checks, {});
});

test('a passing check produces a pass outcome with duration and time', async () => {
  const h = new HealthRegistry({ clock: fixedClock() });
  h.register({ name: 'db', check: () => {} });
  const report = await h.readiness();
  assert.equal(report.status, 'pass');
  const outcome = report.checks.db[0];
  assert.equal(outcome.status, 'pass');
  assert.equal(outcome.kind, 'readiness');
  assert.equal(outcome.critical, true);
  assert.ok(outcome.durationMs >= 0);
  assert.match(outcome.time, /\d{4}-\d{2}-\d{2}T/);
});

test('a returned CheckResult populates status, output, observedValue and details', async () => {
  const h = new HealthRegistry({ clock: fixedClock() });
  h.register({
    name: 'pool',
    check: () => ({ status: 'warn', output: 'low', observedValue: 2, observedUnit: 'conns', region: 'eu' }),
  });
  const report = await h.readiness();
  const o = report.checks.pool[0];
  assert.equal(o.status, 'warn');
  assert.equal(o.output, 'low');
  assert.equal(o.observedValue, 2);
  assert.equal(o.observedUnit, 'conns');
  assert.deepEqual(o.details, { region: 'eu' });
});

test('a throwing check fails with the error message', async () => {
  const h = new HealthRegistry({ clock: fixedClock() });
  h.register({ name: 'cache', check: () => { throw new Error('unreachable'); } });
  const report = await h.readiness();
  assert.equal(report.status, 'fail');
  assert.equal(report.checks.cache[0].status, 'fail');
  assert.equal(report.checks.cache[0].output, 'unreachable');
});

test('a non-Error throwable is stringified', async () => {
  const h = new HealthRegistry({ clock: fixedClock() });
  h.register({ name: 'x', check: () => { throw 'boom'; } });
  const report = await h.readiness();
  assert.equal(report.checks.x[0].output, 'boom');
});

test('a non-critical failure degrades to warn, not fail', async () => {
  const h = new HealthRegistry({ clock: fixedClock() });
  h.register({ name: 'optional', critical: false, check: () => { throw new Error('down'); } });
  const report = await h.readiness();
  assert.equal(report.status, 'warn');
  assert.equal(report.checks.optional[0].status, 'fail');
});

test('a slow check fails with a timeout', async () => {
  const h = new HealthRegistry();
  h.register({
    name: 'slow',
    timeoutMs: 10,
    check: () => new Promise<void>(() => { /* never resolves */ }),
  });
  const report = await h.readiness();
  assert.equal(report.status, 'fail');
  assert.match(report.checks.slow[0].output ?? '', /timed out after 10ms/);
});

test('kinds are isolated across liveness/readiness/startup', async () => {
  const h = new HealthRegistry({ clock: fixedClock() });
  h.register({ name: 'live', kind: 'liveness', check: () => {} });
  h.register({ name: 'ready', kind: 'readiness', check: () => { throw new Error('x'); } });
  h.register({ name: 'boot', kind: 'startup', check: () => {} });

  assert.equal((await h.liveness()).status, 'pass');
  assert.equal((await h.readiness()).status, 'fail');
  assert.equal((await h.startup()).status, 'pass');

  // run() with no kind runs everything
  const all = await h.run();
  assert.equal(Object.keys(all.checks).length, 3);
});

test('endpoint maps pass/warn to 200 and fail to 503', async () => {
  const h = new HealthRegistry({ clock: fixedClock() });
  h.register({ name: 'ok', check: () => {} });
  let res = await h.endpoint('readiness');
  assert.equal(res.statusCode, 200);
  assert.equal(res.contentType, 'application/health+json');
  assert.equal(JSON.parse(res.body).status, 'pass');

  h.register({ name: 'bad', check: () => { throw new Error('no'); } });
  res = await h.endpoint('readiness');
  assert.equal(res.statusCode, 503);
});

test('register/unregister/get/list/clear behave', () => {
  const h = new HealthRegistry();
  h.register({ name: 'a', kind: 'liveness', critical: false, timeoutMs: 100, check: () => {} });
  assert.deepEqual(h.get('a'), { name: 'a', kind: 'liveness', critical: false, timeoutMs: 100 });
  assert.equal(h.list('liveness').length, 1);
  assert.equal(h.list('readiness').length, 0);
  assert.equal(h.unregister('a'), true);
  assert.equal(h.unregister('a'), false);
  assert.equal(h.get('a'), undefined);
  h.register({ name: 'b', check: () => {} });
  h.clear();
  assert.equal(h.list().length, 0);
});

test('duplicate registration throws', () => {
  const h = new HealthRegistry();
  h.register({ name: 'dup', check: () => {} });
  assert.throws(() => h.register({ name: 'dup', check: () => {} }), /already registered/);
});

test('invalid registrations are rejected', () => {
  const h = new HealthRegistry();
  assert.throws(() => h.register({ name: '', check: () => {} }), /non-empty name/);
  assert.throws(() => h.register({ name: 'x', check: undefined as never }), /check function/);
  assert.throws(() => h.register({ name: 'x', check: () => {}, timeoutMs: 0 }), /must be positive/);
});

test('DI token is a stable global symbol', () => {
  assert.equal(HEALTH_REGISTRY, Symbol.for('@streetjs/health:Registry'));
});
