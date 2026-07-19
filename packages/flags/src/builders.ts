// src/builders.ts
// Ergonomic constructors for the common flag shapes.

import type { FlagDefinition, Rollout, TargetingRule } from './types.js';

export interface BooleanFlagOptions {
  /** Master switch. Default true. */
  enabled?: boolean;
  /** Fallthrough value when no rule/rollout applies. Default false. */
  default?: boolean;
  /** Value when `enabled` is false. Default false — a disabled flag is off. */
  offValue?: boolean;
  /** Ordered targeting rules; first match wins. */
  rules?: TargetingRule<boolean>[];
  /** Percentage rollout applied when no rule matches. */
  rollout?: Rollout<boolean>;
}

/**
 * Build a boolean feature flag. Defaults to off (`default: false`) so an
 * un-targeted, un-rolled-out subject sees the flag disabled unless explicitly
 * turned on by a rule or rollout.
 *
 * ```ts
 * booleanFlag('beta-banner', { rollout: { variants: [{ value: true, weight: 10 }] } });
 * ```
 */
export function booleanFlag(key: string, options: BooleanFlagOptions = {}): FlagDefinition<boolean> {
  const def: FlagDefinition<boolean> = {
    key,
    default: options.default ?? false,
  };
  if (options.enabled !== undefined) def.enabled = options.enabled;
  if (options.rules !== undefined) def.rules = options.rules;
  if (options.rollout !== undefined) def.rollout = options.rollout;
  return def;
}
