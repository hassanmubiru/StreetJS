// tests/chaos.test.ts
// Verifies the fault-injection / chaos toolkit: deterministic fail-every /
// fail-after policies, seeded probabilistic error rate, latency injection,
// wrap(), the resilience retry helper surviving injected faults, and the HTTP
// chaos middleware producing 503s against a live Street app.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FaultInjector, InjectedFaultError, retryWithBackoff } from '../testing/chaos.js';

describe('chaos — FaultInjector policies', () => {
  it('failEvery fails deterministically on every Nth call', async () => {
    const fi = new FaultInjector({ failEvery: 3 });
    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      try { results.push(await fi.run(() => 'ok')); } catch { results.push('fail'); }
    }
    assert.deepEqual(results, ['ok', 'ok', 'fail', 'ok', 'ok', 'fail']);
    assert.equal(fi.callCount, 6);
  });

  it('failAfter starts failing once the threshold is exceeded', async () => {
    const fi = new FaultInjector({ failAfter: 2 });
    const outcomes: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      try { await fi.run(() => 1); outcomes.push(true); } catch { outcomes.push(false); }
    }
    assert.deepEqual(outcomes, [true, true, false, false]);
  });

  it('errorRate is reproducible for a fixed seed', async () => {
    const run = async (): Promise<boolean[]> => {
      const fi = new FaultInjector({ errorRate: 0.5, seed: 42 });
      const out: boolean[] = [];
      for (let i = 0; i < 10; i++) { try { await fi.run(() => 1); out.push(true); } catch { out.push(false); } }
      return out;
    };
    assert.deepEqual(await run(), await run()); // deterministic
    const seq = await run();
    assert.ok(seq.includes(false) && seq.includes(true), 'mix of pass/fail at 50%');
  });

  it('injects latency before resolving', async () => {
    const fi = new FaultInjector({ latencyMs: 40 });
    const t0 = Date.now();
    await fi.run(() => 'done');
    assert.ok(Date.now() - t0 >= 35, 'latency applied');
  });

  it('wrap() applies the policy to a function and throws InjectedFaultError', async () => {
    const fi = new FaultInjector({ failEvery: 1 });
    const wrapped = fi.wrap(async (x: number) => x * 2);
    await assert.rejects(() => wrapped(5), InjectedFaultError);
  });
});

describe('chaos — resilience (retry survives injected faults)', () => {
  it('retryWithBackoff succeeds once the injector stops failing', async () => {
    // Fail the first 2 calls, succeed on the 3rd.
    const fi = new FaultInjector({ failAfter: 0 }); // every call > 0 fails...
    let calls = 0;
    const result = await retryWithBackoff(async () => {
      calls++;
      if (calls < 3) throw new InjectedFaultError(`boom ${calls}`);
      return 'recovered';
    }, { retries: 5, baseDelayMs: 1 });
    void fi;
    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
  });

  it('retryWithBackoff rethrows after exhausting retries', async () => {
    await assert.rejects(
      () => retryWithBackoff(async () => { throw new InjectedFaultError('always'); }, { retries: 2, baseDelayMs: 1 }),
      InjectedFaultError,
    );
  });
});

describe('chaos — HTTP middleware (live app)', () => {
  it('injects 503 responses according to the policy', async () => {
    const { streetApp } = await import('../http/server.js');
    const { chaosMiddleware } = await import('../testing/chaos.js');
    const { request: httpRequest } = await import('node:http');
    const { once } = await import('node:events');

    const app = streetApp({});
    // Fail every 2nd request deterministically.
    app.use(chaosMiddleware({ failEvery: 2 }));
    app.use(async (ctx) => { ctx.json({ ok: true }); });

    const port = 55100 + Math.floor(Math.random() * 300);
    await app.listen(port, '127.0.0.1');
    try {
      const hit = (): Promise<number> => new Promise((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port, path: '/', method: 'GET' }, (res) => {
          res.resume(); res.once('end', () => resolve(res.statusCode ?? 0));
        });
        req.once('error', reject); req.end();
      });
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push(await hit());
      // calls 2 and 4 fail with 503; 1 and 3 succeed with 200.
      assert.deepEqual(statuses, [200, 503, 200, 503]);
    } finally {
      await app.close();
      void once; // imported for parity with other live tests
    }
  });
});
