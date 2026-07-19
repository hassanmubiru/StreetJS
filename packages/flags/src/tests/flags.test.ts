// src/tests/flags.test.ts
// Pure, deterministic coverage — no I/O, no time, no randomness.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  FlagRegistry,
  InMemoryFlagStore,
  UnknownFlagError,
  booleanFlag,
  evaluateFlag,
  evaluateFlagDetailed,
  fnv1a32,
  stableBucket,
  type FlagDefinition,
} from '../index.js';

describe('hash', () => {
  it('fnv1a32 is deterministic and unsigned', () => {
    assert.equal(fnv1a32('abc'), fnv1a32('abc'));
    assert.notEqual(fnv1a32('abc'), fnv1a32('abd'));
    assert.ok(fnv1a32('anything') >= 0);
    assert.equal(fnv1a32(''), 0x811c9dc5); // offset basis for empty input
  });

  it('stableBucket is in [0,100), sticky, and flag-scoped', () => {
    const a = stableBucket('flag-1', 'user-1');
    assert.ok(a >= 0 && a < 100);
    assert.equal(a, stableBucket('flag-1', 'user-1')); // sticky
    // Same subject, different flag → generally a different bucket.
    assert.notEqual(stableBucket('flag-1', 'user-1'), stableBucket('flag-2', 'user-1'));
  });
});

describe('evaluateFlag — order & reasons', () => {
  it('kill switch returns offValue (or default) with reason "disabled"', () => {
    const def: FlagDefinition<string> = { key: 'k', enabled: false, default: 'on', offValue: 'off' };
    assert.deepEqual(evaluateFlagDetailed(def), { value: 'off', reason: 'disabled' });
    const def2: FlagDefinition<string> = { key: 'k', enabled: false, default: 'd' };
    assert.equal(evaluateFlag(def2), 'd'); // offValue defaults to default
  });

  it('first matching rule wins (AND across conditions, array membership)', () => {
    const def: FlagDefinition<string> = {
      key: 'k',
      default: 'default',
      rules: [
        { when: { plan: 'free', region: ['us', 'ca'] }, value: 'free-na' },
        { when: { plan: 'pro' }, value: 'pro' },
      ],
    };
    assert.deepEqual(evaluateFlagDetailed(def, { attributes: { plan: 'free', region: 'ca' } }), {
      value: 'free-na', reason: 'rule', ruleIndex: 0,
    });
    assert.equal(evaluateFlag(def, { attributes: { plan: 'pro', region: 'eu' } }), 'pro');
    // free but region not in [us,ca] → no rule 0 match, no rule 1 → default.
    assert.equal(evaluateFlag(def, { attributes: { plan: 'free', region: 'eu' } }), 'default');
    // Missing attribute → condition fails.
    assert.equal(evaluateFlag(def, { attributes: {} }), 'default');
  });

  it('empty `when` is a catch-all rule', () => {
    const def: FlagDefinition<boolean> = { key: 'k', default: false, rules: [{ when: {}, value: true }] };
    assert.equal(evaluateFlag(def, { attributes: { anything: 1 } }), true);
  });

  it('rollout buckets subjects deterministically and falls through beyond total weight', () => {
    // A 100%-weighted single variant always wins.
    const always: FlagDefinition<boolean> = {
      key: 'always', default: false, rollout: { variants: [{ value: true, weight: 100 }] },
    };
    assert.equal(evaluateFlag(always, { key: 'anyone' }), true);

    // A 0%-weighted rollout always falls through to default.
    const never: FlagDefinition<boolean> = {
      key: 'never', default: false, rollout: { variants: [{ value: true, weight: 0 }] },
    };
    const ev = evaluateFlagDetailed(never, { key: 'anyone' });
    assert.equal(ev.value, false);
    assert.equal(ev.reason, 'default');
  });

  it('rollout assignment is stable and split roughly by weight', () => {
    const def: FlagDefinition<'a' | 'b'> = {
      key: 'split',
      default: 'a',
      rollout: { variants: [{ value: 'b', weight: 50 }] }, // 50% see 'b', rest fall through to 'a'
    };
    let b = 0;
    const N = 2000;
    for (let i = 0; i < N; i += 1) {
      if (evaluateFlag(def, { key: `user-${i}` }) === 'b') b += 1;
    }
    // Deterministic hash → expect ~50% within a tolerance band.
    assert.ok(b > N * 0.4 && b < N * 0.6, `expected ~50% in 'b', got ${((b / N) * 100).toFixed(1)}%`);
    // Sticky.
    assert.equal(evaluateFlag(def, { key: 'user-7' }), evaluateFlag(def, { key: 'user-7' }));
  });

  it('rules take precedence over rollout', () => {
    const def: FlagDefinition<boolean> = {
      key: 'k',
      default: false,
      rules: [{ when: { plan: 'enterprise' }, value: true }],
      rollout: { variants: [{ value: true, weight: 0 }] }, // would be false via rollout
    };
    assert.deepEqual(evaluateFlagDetailed(def, { attributes: { plan: 'enterprise' } }), {
      value: true, reason: 'rule', ruleIndex: 0,
    });
  });
});

describe('booleanFlag builder', () => {
  it('defaults to off and carries rules/rollout/enabled through', () => {
    assert.deepEqual(booleanFlag('x'), { key: 'x', default: false });
    const f = booleanFlag('y', {
      enabled: true,
      default: true,
      rules: [{ when: { a: 1 }, value: false }],
      rollout: { variants: [{ value: true, weight: 25 }] },
    });
    assert.equal(f.enabled, true);
    assert.equal(f.default, true);
    assert.equal(f.rules?.length, 1);
    assert.equal(f.rollout?.variants[0]!.weight, 25);
  });
});

describe('FlagRegistry', () => {
  it('registers, evaluates, and reports membership', () => {
    const reg = new FlagRegistry([booleanFlag('a', { default: true })]);
    reg.register(booleanFlag('b'));
    assert.equal(reg.has('a'), true);
    assert.equal(reg.isEnabled('a'), true);
    assert.equal(reg.isEnabled('b'), false);
    assert.deepEqual(reg.keys().sort(), ['a', 'b']);
    assert.equal(reg.get('a')?.default, true);
  });

  it('throws UnknownFlagError for unregistered keys', () => {
    const reg = new FlagRegistry();
    assert.throws(() => reg.evaluate('missing'), UnknownFlagError);
    assert.throws(() => reg.setEnabled('missing', false), UnknownFlagError);
    assert.throws(() => reg.evaluateDetailed('missing'), UnknownFlagError);
  });

  it('rejects invalid registrations', () => {
    const reg = new FlagRegistry();
    assert.throws(() => reg.register({ key: '' } as FlagDefinition<boolean>), /non-empty string/);
  });

  it('setEnabled toggles the kill switch', () => {
    const reg = new FlagRegistry([booleanFlag('a', { default: true })]);
    assert.equal(reg.isEnabled('a'), true);
    reg.setEnabled('a', false);
    assert.equal(reg.isEnabled('a'), false);
    assert.equal(reg.evaluateDetailed('a').reason, 'disabled');
  });

  it('evaluateDetailed exposes rollout bucket', () => {
    const reg = new FlagRegistry([
      booleanFlag('roll', { rollout: { variants: [{ value: true, weight: 100 }] } }),
    ]);
    const ev = reg.evaluateDetailed('roll', { key: 'u1' });
    assert.equal(ev.reason, 'rollout');
    assert.ok(typeof ev.bucket === 'number' && ev.bucket! >= 0 && ev.bucket! < 100);
  });

  it('hydrates from a FlagStore and reflects a reload', async () => {
    const store = new InMemoryFlagStore([booleanFlag('a', { default: true })]);
    const reg = await FlagRegistry.fromStore(store);
    assert.equal(reg.isEnabled('a'), true);
    assert.equal(reg.has('b'), false);

    store.set(booleanFlag('b', { default: true }));
    await reg.loadFrom(store);
    assert.equal(reg.isEnabled('b'), true);
    assert.deepEqual(reg.keys().sort(), ['a', 'b']);

    assert.equal(await store.get('a') !== undefined, true);
    assert.equal(await store.get('nope'), undefined);
  });
});
