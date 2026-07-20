/**
 * @streetjs/i18n — the StreetJS localization foundation.
 *
 * Typed message catalogs with `{var}` interpolation and `Intl`-backed
 * pluralization, locale negotiation (Accept-Language + subtag fallback chains),
 * and number/date/list formatting. Zero runtime dependencies (built-in `Intl`
 * only) — safe on Node, edge runtimes, and browsers.
 *
 * ```ts
 * import { I18n } from '@streetjs/i18n';
 *
 * const i18n = new I18n({
 *   defaultLocale: 'en',
 *   catalogs: {
 *     en: { greeting: 'Hello, {name}!', items: { one: '{count} item', other: '{count} items' } },
 *     fr: { greeting: 'Bonjour, {name} !' },
 *   },
 * });
 *
 * i18n.t('greeting', { name: 'Ada' }, 'fr');   // "Bonjour, Ada !"
 * i18n.plural('items', 3);                      // "3 items"
 * ```
 */

export { I18n, I18N } from './i18n.js';
export {
  parseAcceptLanguage,
  negotiateLocale,
  defaultFallbackChain,
  type LanguageRange,
} from './locale.js';
export {
  interpolate,
  pluralCategory,
  formatNumber,
  formatDate,
  formatList,
} from './format.js';
export type {
  MessageParam,
  MessageValue,
  PluralMessage,
  Catalog,
  I18nOptions,
} from './types.js';
