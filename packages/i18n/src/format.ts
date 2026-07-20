// src/format.ts
// Interpolation + Intl-backed formatting. Pure, dependency-free (uses built-in
// Intl, available on Node, edge runtimes, and browsers).

import type { MessageParam } from './types.js';

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Replace `{name}` placeholders in `template` with values from `params`.
 * Unknown placeholders are left intact (so gaps are visible in development);
 * `{{` and `}}` are unescaped to literal braces.
 */
export function interpolate(template: string, params: Record<string, MessageParam> = {}): string {
  const out = template.replace(PLACEHOLDER, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
  return out.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}

/** Select the CLDR plural category for `count` in `locale` (fallback: 'other'). */
export function pluralCategory(locale: string, count: number, type: 'cardinal' | 'ordinal' = 'cardinal'): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(locale, { type }).select(count);
  } catch {
    return 'other';
  }
}

/** Format a number for a locale via `Intl.NumberFormat`. */
export function formatNumber(locale: string, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Format a date for a locale via `Intl.DateTimeFormat`. */
export function formatDate(
  locale: string,
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(locale, options).format(value);
}

/** Format a list for a locale via `Intl.ListFormat`. */
export function formatList(
  locale: string,
  items: string[],
  options?: Intl.ListFormatOptions,
): string {
  return new Intl.ListFormat(locale, options).format(items);
}
