// src/i18n.ts
// The I18n facade: catalog resolution with fallback, interpolation, and
// Intl-backed pluralization + number/date/list formatting.

import { defaultFallbackChain } from './locale.js';
import { formatDate, formatList, formatNumber, interpolate, pluralCategory } from './format.js';
import type { Catalog, I18nOptions, MessageParam, MessageValue, PluralMessage } from './types.js';

/** DI token for a shared {@link I18n} instance. */
export const I18N = 'streetjs.i18n' as const;

export class I18n {
  readonly defaultLocale: string;
  private readonly catalogs: Record<string, Catalog>;
  private readonly fallbackChain: (locale: string) => string[];
  private readonly onMissing: ((key: string, locale: string) => void) | undefined;

  constructor(options: I18nOptions) {
    if (!options?.defaultLocale) throw new Error('I18n: defaultLocale is required');
    this.defaultLocale = options.defaultLocale;
    this.catalogs = options.catalogs ?? {};
    this.fallbackChain = options.fallbackChain ?? defaultFallbackChain;
    this.onMissing = options.onMissing;
  }

  /** Locales that have a registered catalog. */
  availableLocales(): string[] {
    return Object.keys(this.catalogs);
  }

  /** Add or replace a locale's catalog (merged over any existing entries). */
  addCatalog(locale: string, catalog: Catalog): void {
    this.catalogs[locale] = { ...(this.catalogs[locale] ?? {}), ...catalog };
  }

  /**
   * Translate `key` for `locale` (default: `defaultLocale`), interpolating
   * `params`. Resolution walks the locale's fallback chain and then the default
   * locale; if the key is found nowhere, `onMissing` is invoked and the key
   * itself is returned (so UIs degrade visibly, never crash).
   */
  t(key: string, params: Record<string, MessageParam> = {}, locale?: string): string {
    const loc = locale ?? this.defaultLocale;
    const raw = this.resolve(key, loc);
    if (raw === undefined) {
      this.onMissing?.(key, loc);
      return key;
    }
    if (typeof raw !== 'string') {
      // A plural entry used without a count: fall back to its `other` form.
      return interpolate(raw.other, params);
    }
    return interpolate(raw, params);
  }

  /**
   * Translate a pluralized `key` by selecting the CLDR category for `count`
   * (via `Intl.PluralRules`) from a plural message, then interpolating. `count`
   * is made available to the message as `{count}`. Falls back to the `other`
   * form, and to the key when missing.
   */
  plural(
    key: string,
    count: number,
    params: Record<string, MessageParam> = {},
    locale?: string,
  ): string {
    const loc = locale ?? this.defaultLocale;
    const raw = this.resolve(key, loc);
    if (raw === undefined) {
      this.onMissing?.(key, loc);
      return key;
    }
    const merged = { count, ...params };
    if (typeof raw === 'string') {
      // Not authored as a plural map: interpolate as-is.
      return interpolate(raw, merged);
    }
    const category = pluralCategory(loc, count);
    const template = this.selectPlural(raw, category);
    return interpolate(template, merged);
  }

  /** Whether `key` resolves in `locale`'s chain (or the default locale). */
  has(key: string, locale?: string): boolean {
    return this.resolve(key, locale ?? this.defaultLocale) !== undefined;
  }

  // ── Formatting (bound to a locale, defaulting to defaultLocale) ───────────────

  number(value: number, options?: Intl.NumberFormatOptions, locale?: string): string {
    return formatNumber(locale ?? this.defaultLocale, value, options);
  }

  date(value: Date | number, options?: Intl.DateTimeFormatOptions, locale?: string): string {
    return formatDate(locale ?? this.defaultLocale, value, options);
  }

  list(items: string[], options?: Intl.ListFormatOptions, locale?: string): string {
    return formatList(locale ?? this.defaultLocale, items, options);
  }

  // ── internals ────────────────────────────────────────────────────────────────

  /** Resolve a raw message by walking the fallback chain then the default. */
  private resolve(key: string, locale: string): MessageValue | undefined {
    const chain = this.fallbackChain(locale);
    for (const loc of chain) {
      const cat = this.catalogs[loc];
      if (cat && Object.prototype.hasOwnProperty.call(cat, key)) return cat[key];
    }
    // Final fallback: the default locale (if not already in the chain).
    if (!chain.includes(this.defaultLocale)) {
      const cat = this.catalogs[this.defaultLocale];
      if (cat && Object.prototype.hasOwnProperty.call(cat, key)) return cat[key];
    }
    return undefined;
  }

  private selectPlural(msg: PluralMessage, category: Intl.LDMLPluralRule): string {
    const value = msg[category];
    return value !== undefined ? value : msg.other;
  }
}
