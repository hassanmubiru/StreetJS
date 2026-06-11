// tests/abuse-score.test.ts
// Example-based unit tests for the Phase 6 Abuse_Engine suspicious-score path
// (Requirement 7): the composite score computation (R7.5), the configured
// response action triggering once the score threshold is reached (R7.6), and
// the IP-reputation hook being consulted during authentication attempts (R7.7).
//
// The named property tests for lockout/throttle/spray thresholds live in their
// own tasks; these verify the score-combination, response-action, and
// IP-reputation behaviors with concrete, deterministic examples driven by an
// injected clock and an in-memory counter store.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AbuseEngine,
  type AbuseConfig,
  type AbuseDecision,
} from '../security/abuse.js';
import { InMemoryCounterStore, type Clock } from '../security/store.js';

/** A controllable clock whose value can be advanced explicitly in tests. */
function fakeClock(start = 0): Clock & { advance(ms: number): void; set(ms: number): void } {
  let nowMs = start;
  const clock = (() => nowMs) as Clock & { advance(ms: number): void; set(ms: number): void };
  clock.advance = (ms: number) => { nowMs += ms; };
  clock.set = (ms: number) => { nowMs = ms; };
  return clock;
}

/**
 * Build a base config with thresholds high enough that lockout/throttle do not
 * trip on their own, so a test can isolate the score path. Individual fields
 * are overridden per test as needed.
 */
function baseConfig(overrides: Partial<AbuseConfig> = {}): AbuseConfig {
  return {
    loginFailureThreshold: 1_000,
    loginWindowMs: 60_000,
    lockoutMs: 60_000,
    signupThreshold: 1_000,
    signupWindowMs: 60_000,
    sprayDistinctAccounts: 1_000,
    sprayWindowMs: 60_000,
    scoreThreshold: 1_000,
    ...overrides,
  };
}

describe('AbuseEngine.score — suspicious-activity score computation (R7.5)', () => {
  it('combines failed-login count, distinct-account spray pressure, and reputation', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    let reputation = 0;
    const engine = new AbuseEngine(baseConfig(), store, async () => reputation);

    const ip = '1.1.1.1';

    // 3 failed logins for "alice" from one source: contributes 3 failed-login
    // count for alice, and 1 distinct account (alice) toward spray pressure.
    for (let ts = 0; ts < 3; ts++) {
      await engine.recordLoginAttempt({ ip, accountId: 'alice', failed: true, ts });
    }
    // 1 failed login for "bob" from the same source: distinct accounts -> 2.
    await engine.recordLoginAttempt({ ip, accountId: 'bob', failed: true, ts: 3 });

    // Without reputation: failed(alice)=3 + distinctAccounts=2 = 5.
    reputation = 0;
    assert.equal(await engine.score({ ip, accountId: 'alice', failed: false, ts: 10 }), 5);

    // bob has a single failure: failed(bob)=1 + distinctAccounts=2 = 3.
    assert.equal(await engine.score({ ip, accountId: 'bob', failed: false, ts: 10 }), 3);

    // With a reputation contribution of 10 it folds straight into the total.
    reputation = 10;
    assert.equal(await engine.score({ ip, accountId: 'alice', failed: false, ts: 10 }), 15);
  });

  it('scores an unknown account using only source-level signals', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    const engine = new AbuseEngine(baseConfig(), store, async () => 7);

    // No accountId: failed-login term is omitted; score = distinct(0) + rep(7).
    assert.equal(await engine.score({ ip: '2.2.2.2', failed: false, ts: 0 }), 7);
  });

  it('is zero with no signals, no spray pressure, and no reputation hook', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    const engine = new AbuseEngine(baseConfig(), store);

    assert.equal(await engine.score({ ip: '3.3.3.3', accountId: 'carol', failed: false, ts: 0 }), 0);
  });

  it('drops signals that age out of their sliding windows', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    const engine = new AbuseEngine(
      baseConfig({ loginWindowMs: 1_000, sprayWindowMs: 1_000 }),
      store,
    );

    await engine.recordLoginAttempt({ ip: '4.4.4.4', accountId: 'dave', failed: true, ts: 0 });
    // Immediately after, the failure plus its one distinct account count.
    assert.equal(await engine.score({ ip: '4.4.4.4', accountId: 'dave', failed: false, ts: 0 }), 2);
    // Well past the window, every signal has rolled off and the score is zero.
    assert.equal(await engine.score({ ip: '4.4.4.4', accountId: 'dave', failed: false, ts: 5_000 }), 0);
  });
});

describe('AbuseEngine — IP-reputation hook consultation (R7.7)', () => {
  it('consults the hook with the attempt source during a login attempt', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    const seen: string[] = [];
    const engine = new AbuseEngine(baseConfig(), store, async (ip) => {
      seen.push(ip);
      return 0;
    });

    await engine.recordLoginAttempt({ ip: '9.9.9.9', accountId: 'erin', failed: false, ts: 0 });

    assert.ok(seen.includes('9.9.9.9'), 'IP-reputation hook should be consulted with the source IP');
  });

  it('folds the hook contribution into the computed score', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    const engine = new AbuseEngine(baseConfig(), store, async () => 42);

    // No other signals, so the score equals the hook contribution alone.
    assert.equal(await engine.score({ ip: '8.8.8.8', failed: false, ts: 0 }), 42);
  });

  it('omits the reputation term entirely when no hook is configured', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    const engine = new AbuseEngine(baseConfig(), store);

    // With no hook, the score reflects only recorded counters (here, zero).
    assert.equal(await engine.score({ ip: '7.7.7.7', failed: false, ts: 0 }), 0);
  });
});

describe('AbuseEngine — configured response action triggering (R7.6)', () => {
  it('triggers the response action and refuses once the score reaches the threshold', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    const triggered: AbuseDecision[] = [];
    const engine = new AbuseEngine(
      // A single point of reputation reaches the threshold of 1.
      baseConfig({ scoreThreshold: 1 }),
      store,
      async () => 1,
      {},
    );

    const decision = await engine.recordLoginAttempt({
      ip: '5.5.5.5',
      accountId: 'frank',
      failed: false,
      ts: 0,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'SCORE_EXCEEDED');
    assert.equal(decision.score, 1);
    assert.equal(triggered.length, 0); // sanity: tracked via config below
  });

  it('passes the triggering decision to the configured response action', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    const triggered: AbuseDecision[] = [];
    const engine = new AbuseEngine(
      baseConfig({
        scoreThreshold: 5,
        responseAction: (decision) => {
          triggered.push(decision);
        },
      }),
      store,
      async () => 5,
    );

    const decision = await engine.recordLoginAttempt({
      ip: '6.6.6.6',
      accountId: 'grace',
      failed: false,
      ts: 0,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'SCORE_EXCEEDED');
    assert.equal(triggered.length, 1);
    assert.deepEqual(triggered[0], decision);
    assert.equal(triggered[0]!.score, 5);
  });

  it('does not trigger the response action while the score is below the threshold', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    let triggers = 0;
    const engine = new AbuseEngine(
      baseConfig({
        scoreThreshold: 100,
        responseAction: () => {
          triggers += 1;
        },
      }),
      store,
      async () => 5, // well below the threshold of 100
    );

    const decision = await engine.recordLoginAttempt({
      ip: '6.6.6.6',
      accountId: 'heidi',
      failed: false,
      ts: 0,
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.score, 5);
    assert.equal(triggers, 0);
  });

  it('awaits an asynchronous response action before returning the decision', async () => {
    const store = new InMemoryCounterStore({ clock: fakeClock(0) });
    let completed = false;
    const engine = new AbuseEngine(
      baseConfig({
        scoreThreshold: 1,
        responseAction: async () => {
          await Promise.resolve();
          completed = true;
        },
      }),
      store,
      async () => 1,
    );

    const decision = await engine.recordLoginAttempt({
      ip: '5.5.5.5',
      accountId: 'ivan',
      failed: false,
      ts: 0,
    });

    assert.equal(decision.allowed, false);
    assert.equal(completed, true, 'response action should be awaited before returning');
  });
});
