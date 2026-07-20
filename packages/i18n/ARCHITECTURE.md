# Architecture — @streetjs/i18n

## Position in the framework

`@streetjs/i18n` is a **foundation leaf**: a zero-dependency, core-independent
package that owns localization *mechanics* (catalog resolution, interpolation,
pluralization, locale negotiation, formatting) but no product copy. Applications
supply catalogs and consume the `I18n` facade.

```
types.ts   ← contracts (Catalog, MessageValue, PluralMessage, I18nOptions)
locale.ts  ← parseAcceptLanguage / defaultFallbackChain / negotiateLocale (pure)
format.ts  ← interpolate + Intl wrappers (pluralCategory/number/date/list)
i18n.ts    ← I18n facade (resolve → interpolate/pluralize) + I18N token
index.ts   ← barrel
```

Module graph is acyclic: `i18n → { locale, format } → (types)`. No module
imports `streetjs` core, so the package runs on Node, edge, and browser.

## Design decisions

- **Built-in `Intl`, no CLDR payload.** Pluralization uses `Intl.PluralRules`;
  number/date/list formatting use `Intl.NumberFormat` / `DateTimeFormat` /
  `ListFormat`. This keeps the package dependency-free and small — the runtime
  already ships the locale data — at the cost of depending on the runtime's
  `Intl` locale coverage (an explicit, documented tradeoff).

- **Plural messages as category maps.** Rather than parse an ICU MessageFormat
  mini-language, plural entries are authored as `{ one, other, … }` maps keyed
  by CLDR category. `Intl.PluralRules` selects the category; a missing category
  falls back to the required `other`. This is simple, fully typed, and avoids
  shipping a parser.

- **Interpolation leaves unknown placeholders intact.** Missing params keep
  `{name}` visible (surfacing gaps in development) instead of silently blanking;
  `{{`/`}}` unescape to literal braces.

- **Deterministic fallback.** Resolution walks the requested locale's
  subtag-trimmed chain, then the default locale. An unresolved key returns the
  key itself and calls `onMissing` — never throws — so a missing translation
  degrades gracefully in production.

- **Negotiation matches broadly.** `negotiateLocale` tries exact
  (case-insensitive) matches first, then primary-subtag matches in both
  directions (`en-US` accepts `en`, and `en` accepts `en-GB`), then the default.

## Testing

`node:test`, pure — no I/O. Covers interpolation (incl. escaping and unknown
placeholders), Accept-Language parsing (q-ordering, malformed q, blanks),
fallback chains, negotiation (exact/primary/wildcard/empty), Intl formatting +
plural-category safety, and the full `I18n` facade (fallback, missing-key,
plural selection incl. `other` fallback, catalog merge). 25 tests, 100% line
coverage.

## Boundaries

Not consumed by `@streetjs/core`; a standalone, opt-in foundation package.
