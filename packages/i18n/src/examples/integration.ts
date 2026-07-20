// src/examples/integration.ts
// Runnable example: `node dist/examples/integration.js`. No I/O, no deps.

import { I18n, negotiateLocale } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

const i18n = new I18n({
  defaultLocale: 'en',
  catalogs: {
    en: {
      greeting: 'Hello, {name}!',
      unread: { one: 'You have {count} unread message', other: 'You have {count} unread messages' },
      'billing.total': 'Total due: {amount}',
    },
    fr: {
      greeting: 'Bonjour, {name} !',
      unread: { one: 'Vous avez {count} message non lu', other: 'Vous avez {count} messages non lus' },
    },
  },
});

// 1. Negotiate a locale from an Accept-Language header.
const locale = negotiateLocale('fr-CA,fr;q=0.9,en;q=0.8', i18n.availableLocales(), 'en');
console.log('negotiated locale:', locale);
assert(locale === 'fr', 'fr negotiated');

// 2. Interpolated translation in the negotiated locale.
console.log(i18n.t('greeting', { name: 'Ada' }, locale));
assert(i18n.t('greeting', { name: 'Ada' }, locale) === 'Bonjour, Ada !', 'fr greeting');

// 3. Pluralization (Intl.PluralRules-backed).
console.log(i18n.plural('unread', 1, {}, locale));
console.log(i18n.plural('unread', 5, {}, locale));
assert(i18n.plural('unread', 1, {}, locale) === 'Vous avez 1 message non lu', 'fr singular');
assert(i18n.plural('unread', 5, {}, locale) === 'Vous avez 5 messages non lus', 'fr plural');

// 4. Fallback: fr has no billing.total → falls back to en.
console.log(i18n.t('billing.total', { amount: i18n.number(4900 / 100, { style: 'currency', currency: 'EUR' }, 'fr') }, locale));

// 5. Number/date/list formatting bound to a locale.
console.log('number:', i18n.number(1234567.89, { maximumFractionDigits: 2 }, 'en'));
console.log('list:', i18n.list(['video', 'audio', 'captions'], { type: 'conjunction' }, 'en'));

console.log('\nAll @streetjs/i18n example assertions passed.');
