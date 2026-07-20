// src/types.ts
// Public contracts for the localization foundation.

/** Values interpolable into a message. */
export type MessageParam = string | number | boolean;

/**
 * A catalog entry: either a plain string with `{var}` placeholders, or a
 * plural map keyed by Intl plural category (`zero`/`one`/`two`/`few`/`many`/
 * `other`) — `other` is required as the fallback.
 */
export type MessageValue = string | PluralMessage;

/** A plural message keyed by CLDR plural category; `other` is mandatory. */
export interface PluralMessage {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** A flat map of message keys → values for a single locale. */
export type Catalog = Record<string, MessageValue>;

/** Options for constructing an {@link I18n} instance. */
export interface I18nOptions {
  /** The default/base locale used when negotiation yields nothing. */
  defaultLocale: string;
  /** Per-locale catalogs, keyed by BCP-47 tag (e.g. `en`, `en-US`, `fr`). */
  catalogs: Record<string, Catalog>;
  /**
   * Custom fallback chain for a locale. Default derives it by trimming subtags
   * (e.g. `zh-Hant-TW` → `zh-Hant` → `zh`) and always ends at `defaultLocale`.
   */
  fallbackChain?: (locale: string) => string[];
  /** Called when a key resolves in no catalog in the chain (dev diagnostics). */
  onMissing?: (key: string, locale: string) => void;
}
