// src/evaluate.ts
// Pure flag evaluation. No I/O, no dependencies.

import { stableBucket } from './hash.js';
import type {
  AttributeValue,
  FlagContext,
  FlagDefinition,
  FlagEvaluation,
  TargetingRule,
} from './types.js';

/** Does a single rule condition match the context attributes? */
function conditionMatches(
  attributes: Record<string, AttributeValue>,
  attr: string,
  expected: AttributeValue | AttributeValue[],
): boolean {
  if (!(attr in attributes)) return false;
  const actual = attributes[attr];
  if (Array.isArray(expected)) return expected.includes(actual as AttributeValue);
  return actual === expected;
}

/** Does a rule match the context (all conditions AND)? Empty `when` = catch-all. */
function ruleMatches<T>(rule: TargetingRule<T>, context: FlagContext): boolean {
  const attributes = context.attributes ?? {};
  for (const [attr, expected] of Object.entries(rule.when)) {
    if (!conditionMatches(attributes, attr, expected)) return false;
  }
  return true;
}

/**
 * Evaluate a flag against a context, returning both the value and the reason.
 * See {@link FlagDefinition} for the evaluation order.
 */
export function evaluateFlagDetailed<T>(
  def: FlagDefinition<T>,
  context: FlagContext = {},
): FlagEvaluation<T> {
  // 1. Kill switch.
  if (def.enabled === false) {
    return { value: def.offValue !== undefined ? def.offValue : def.default, reason: 'disabled' };
  }

  // 2. Targeting rules (first match wins).
  if (def.rules) {
    for (let i = 0; i < def.rules.length; i += 1) {
      const rule = def.rules[i]!;
      if (ruleMatches(rule, context)) {
        return { value: rule.value, reason: 'rule', ruleIndex: i };
      }
    }
  }

  // 3. Percentage rollout (stable per-subject bucketing).
  if (def.rollout && def.rollout.variants.length > 0) {
    const bucket = stableBucket(def.key, context.key ?? '');
    let cumulative = 0;
    for (const variant of def.rollout.variants) {
      cumulative += variant.weight;
      if (bucket < cumulative) {
        return { value: variant.value, reason: 'rollout', bucket };
      }
    }
    // Bucket beyond total weight → fall through to default.
  }

  // 4. Default.
  return { value: def.default, reason: 'default' };
}

/** Evaluate a flag, returning only the resolved value. */
export function evaluateFlag<T>(def: FlagDefinition<T>, context: FlagContext = {}): T {
  return evaluateFlagDetailed(def, context).value;
}
