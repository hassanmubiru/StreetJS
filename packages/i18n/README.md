# @streetjs/i18n

The StreetJS **localization foundation**: typed message catalogs with `{var}`
interpolation and `Intl`-backed pluralization, locale negotiation
(Accept-Language + subtag fallback chains), and number/date/list formatting.
Zero runtime dependencies (built-in `Intl` only) — safe on Node, edge runtimes,
and in the browser.

## Install

```sh
npm install @streetjs/i18n
```

## Usage

```ts
import { I18n } from '@streetjs/i18n';

const i18n = new I18n({
  defaultLocale: 'en',
  catalogs: {
    en: {
      greeting: 'Hello, {name}!',
      unread: { one: '{count} unread message', other: '{count} unread messages' },
    },
    fr: { greeting: 'Bonjour, {name} !' },
  },
});

i18n.t('greeting', { name: 'Ada' });        // "Hello, Ada!"
i18n.t('greeting', { name: 'Ada' }, 'fr');  // "Bonjour, Ada !"
i18n.plural('unread', 3);                    // "3 unread messages"
```

### Pluralization

Author a message as a map keyed by CLDR plural category (`other` required); the
category for a given `count` is chosen via `Intl.PluralRules` for the target
locale, and `{count}` is injected automatically:

```ts
i18n.plural('unread', 1); // "1 unread message"  (category: one)
i18n.plural('unread', 5); // "5 unread messages" (category: other)
```

### Locale negotiation & fallback

```ts
import { negotiateLocale } from '@streetjs/i18n';

const locale = negotiateLocale(
  req.headers['accept-language'] ?? '',   // e.g. "fr-CA,fr;q=0.9,en;q=0.8"
  i18n.availableLocales(),
  'en',
);
```

Resolution walks the requested locale's fallback chain (`en-US` → `en`;
`zh-Hant-TW` → `zh-Hant` → `zh`) and finally the default locale. A key that
resolves nowhere returns the key itself (UIs degrade visibly, never crash) and
invokes the optional `onMissing` hook for dev diagnostics.

### Formatting

```ts
i18n.number(1234.5, { style: 'currency', currency: 'USD' }); // "$1,234.50"
i18n.date(Date.now(), { dateStyle: 'medium' });
i18n.list(['video', 'audio', 'captions'], { type: 'conjunction' }); // "video, audio, and captions"
```

All formatting binds to `defaultLocale` unless an explicit locale is passed.

## API

| Export | Description |
| ------ | ----------- |
| `I18n` | `t`, `plural`, `has`, `number`, `date`, `list`, `addCatalog`, `availableLocales`. |
| `negotiateLocale` / `parseAcceptLanguage` / `defaultFallbackChain` | Locale selection. |
| `interpolate` / `pluralCategory` | Pure interpolation + CLDR category selection. |
| `formatNumber` / `formatDate` / `formatList` | Pure `Intl` wrappers. |
| `I18N` | DI token for a shared instance. |

## Design notes

- **Built-in `Intl` only** — no bundled CLDR data, no dependency; pluralization,
  number/date/list formatting all defer to the runtime's `Intl`.
- **Framework, not product** — this owns the localization *mechanics*; the actual
  translated copy lives with the product.

## License

MIT — see [LICENSE](./LICENSE).
