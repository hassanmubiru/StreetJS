# Changelog

All notable changes to `@streetjs/i18n` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Initial release of the StreetJS localization foundation.
- `I18n` facade: `t` (interpolated translation with fallback), `plural`
  (CLDR-category selection via `Intl.PluralRules`, auto `{count}`), `has`,
  `addCatalog`, `availableLocales`, and locale-bound `number` / `date` / `list`
  formatting.
- Locale negotiation: `parseAcceptLanguage` (q-ordered), `defaultFallbackChain`
  (subtag trimming), and `negotiateLocale` (exact → primary-subtag → default).
- Pure helpers: `interpolate` (`{var}` + `{{`/`}}` escaping) and `Intl` wrappers
  `pluralCategory` / `formatNumber` / `formatDate` / `formatList`.
- Typed catalogs (`Catalog`, `MessageValue`, `PluralMessage`); `I18N` DI token;
  unresolved keys return the key and invoke an optional `onMissing` hook.
- Zero runtime dependencies (built-in `Intl` only); ESM + `browser` export. 25
  tests, 100% line coverage, runnable example.
