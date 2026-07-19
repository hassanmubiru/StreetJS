/**
 * @streetjs/flags — the StreetJS feature-flag foundation.
 *
 * Typed boolean and multivariate flags with attribute-based targeting rules and
 * deterministic percentage rollouts (sticky per-subject bucketing via a pure
 * FNV-1a hash — no dependency, edge/browser-safe). A `FlagRegistry` evaluates
 * synchronously against in-memory definitions; a pluggable `FlagStore` seam
 * hydrates them from a DB / Redis / config service.
 *
 * ```ts
 * import { FlagRegistry, booleanFlag } from '@streetjs/flags';
 *
 * const flags = new FlagRegistry([
 *   booleanFlag('new-editor', {
 *     rules: [{ when: { plan: 'enterprise' }, value: true }],
 *     rollout: { variants: [{ value: true, weight: 20 }] }, // 20% of everyone else
 *   }),
 * ]);
 *
 * flags.isEnabled('new-editor', { key: userId, attributes: { plan } });
 * ```
 */

export { evaluateFlag, evaluateFlagDetailed } from './evaluate.js';
export { fnv1a32, stableBucket } from './hash.js';
export {
  FlagRegistry,
  InMemoryFlagStore,
  UnknownFlagError,
  type FlagStore,
} from './registry.js';
export { booleanFlag } from './builders.js';

export {
  FLAG_REGISTRY,
  type AttributeValue,
  type FlagContext,
  type TargetingRule,
  type RolloutVariant,
  type Rollout,
  type FlagDefinition,
  type FlagEvaluation,
} from './types.js';
