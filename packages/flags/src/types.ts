// src/types.ts
// Public contracts for the feature-flag foundation.

/** Attribute value types usable in targeting rules and contexts. */
export type AttributeValue = string | number | boolean;

/**
 * The subject a flag is evaluated for. `key` is the stable identity used for
 * deterministic rollout bucketing (e.g. a user id, org id, or session id);
 * `attributes` drive targeting rules (e.g. plan, region, role).
 */
export interface FlagContext {
  /** Stable subject identity for rollout bucketing. Defaults to '' (anonymous). */
  key?: string;
  /** Attributes matched by targeting rules. */
  attributes?: Record<string, AttributeValue>;
}

/**
 * A single targeting rule. All conditions in `when` must match (AND). Each
 * condition matches when the context attribute equals the given value, or — if
 * the condition value is an array — when the attribute is one of its members.
 * A rule with an empty `when` matches everything (a catch-all).
 */
export interface TargetingRule<T> {
  when: Record<string, AttributeValue | AttributeValue[]>;
  value: T;
}

/** One weighted variant in a percentage rollout. `weight` is a percentage. */
export interface RolloutVariant<T> {
  value: T;
  /** Percentage weight in `[0, 100]`. Cumulative weights should not exceed 100. */
  weight: number;
}

/**
 * A percentage rollout: subjects are deterministically bucketed into `[0, 100)`
 * by a stable hash of `flagKey + context.key`, then assigned to the first
 * variant whose cumulative weight covers the bucket. Buckets beyond the total
 * weight fall through to the flag's `default`.
 */
export interface Rollout<T> {
  variants: RolloutVariant<T>[];
}

/**
 * A fully-typed flag definition.
 *
 * Evaluation order:
 *  1. `enabled === false` → `offValue` (or `default` if unset) — a kill switch.
 *  2. first matching `rules` entry (in order) → its `value`.
 *  3. `rollout` (stable per-subject bucketing) → a variant `value`.
 *  4. otherwise → `default`.
 */
export interface FlagDefinition<T = boolean> {
  key: string;
  /** Master switch. Default true. When false, evaluation returns `offValue`. */
  enabled?: boolean;
  /** Fallthrough value when no rule/rollout applies. */
  default: T;
  /** Value returned when `enabled` is false. Defaults to `default`. */
  offValue?: T;
  /** Ordered targeting rules; first match wins. */
  rules?: TargetingRule<T>[];
  /** Percentage rollout applied when no rule matches. */
  rollout?: Rollout<T>;
}

/** The outcome of evaluating a flag, including why the value was chosen. */
export interface FlagEvaluation<T> {
  value: T;
  reason: 'disabled' | 'rule' | 'rollout' | 'default';
  /** Index of the matched rule, when `reason === 'rule'`. */
  ruleIndex?: number;
  /** The rollout bucket in `[0, 100)`, when `reason === 'rollout'`. */
  bucket?: number;
}

/** DI token for a shared {@link FlagRegistry} instance. */
export const FLAG_REGISTRY = 'streetjs.flags.registry' as const;
