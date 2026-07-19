// src/examples/integration.ts
// Runnable example: `node dist/examples/integration.js`. No I/O, no deps.

import { FlagRegistry, booleanFlag, evaluateFlagDetailed, type FlagDefinition } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

// A registry seeded with two flags: a plan-gated capability and a staged rollout.
const flags = new FlagRegistry([
  booleanFlag('new-review-player', {
    // Enterprise always on; everyone else via a 25% staged rollout.
    rules: [{ when: { plan: 'enterprise' }, value: true }],
    rollout: { variants: [{ value: true, weight: 25 }] },
  }),
]);

// A multivariate flag (string variants) registered directly.
const theme: FlagDefinition<'classic' | 'compact'> = {
  key: 'editor-theme',
  default: 'classic',
  rules: [{ when: { beta: true }, value: 'compact' }],
};
flags.register(theme);

// 1. Plan gating: enterprise always sees the new player.
assert(flags.isEnabled('new-review-player', { key: 'u1', attributes: { plan: 'enterprise' } }), 'enterprise on');
console.log('enterprise → new-review-player:', flags.isEnabled('new-review-player', { key: 'u1', attributes: { plan: 'enterprise' } }));

// 2. Staged rollout: deterministic + sticky across calls for the same subject.
const sample = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
const on = sample.filter((u) => flags.isEnabled('new-review-player', { key: u, attributes: { plan: 'free' } }));
console.log('rollout (free plan) enabled for:', on.length ? on.join(', ') : '(none in this sample)');
for (const u of sample) {
  const a = flags.isEnabled('new-review-player', { key: u, attributes: { plan: 'free' } });
  const b = flags.isEnabled('new-review-player', { key: u, attributes: { plan: 'free' } });
  assert(a === b, `sticky assignment for ${u}`);
}

// 3. Multivariate targeting.
type Theme = 'classic' | 'compact';
console.log('beta user theme:', flags.evaluate<Theme>('editor-theme', { attributes: { beta: true } }));
console.log('default theme:', flags.evaluate<Theme>('editor-theme', { attributes: {} }));
assert(flags.evaluate<Theme>('editor-theme', { attributes: { beta: true } }) === 'compact', 'beta → compact');

// 4. Kill switch + evaluation reason.
flags.setEnabled('new-review-player', false);
const ev = evaluateFlagDetailed(flags.get('new-review-player')!, { key: 'u1', attributes: { plan: 'enterprise' } });
console.log('after kill switch → reason:', ev.reason, '| value:', ev.value);
assert(ev.reason === 'disabled' && ev.value === false, 'kill switch disables even enterprise');

console.log('\nAll @streetjs/flags example assertions passed.');
