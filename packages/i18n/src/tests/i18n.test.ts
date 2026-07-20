// src/tests/i18n.test.ts
// Pure, deterministic coverage. Uses built-in Intl; no I/O.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  I18n,
  parseAcceptLanguage,
  negotiateLocale,
  defaultFallbackChain,
  interpolate,
  pluralCategory,
  formatNumber,
  formatDate,
  formatList,
  type Catalog,
} from '../index.js';

// ── interpolate ────────────────────────────────────────────────────────────────

describe('interpolate', () => {
  it('replaces known placeholders and leaves unknown ones intact', () => {
    assert.equal(interpolate('Hi {name}, you have {n}', { name: 'Ada', n: 3 }), 'Hi Ada, you have 3');
    assert.equal(interpolate('Hi {name}', {}), 'Hi {name}');
  });
  it('unescapes doubled braces', () => {
    assert.equal(interpolate('{{literal}} {x}', { x: 1 }), '{literal} 1');
  });
});

// ── locale negotiation ─────────────────────────────────────────────────────────

describe('parseAcceptLanguage', () => {
  it('orders by q, defaulting to 1, preserving input order on ties', () => {
    const r = parseAcceptLanguage('fr-CA,fr;q=0.9,en;q=0.8,*;q=0.5');
    assert.deepEqual(r.map((x) => x.tag), ['fr-CA', 'fr', 'en', '*']);
    assert.equal(r[0]!.quality, 1);
  });
  it('returns [] for empty/blank headers', () => {
    assert.deepEqual(parseAcceptLanguage(''), []);
    assert.deepEqual(parseAcceptLanguage('   '), []);
  });
  it('ignores a malformed q value (keeps quality 1) and skips empty tags', () => {
    const r = parseAcceptLanguage('en;q=abc, ,de');
    assert.deepEqual(r.map((x) => x.tag), ['en', 'de']);
    assert.equal(r[0]!.quality, 1);
  });
});

describe('defaultFallbackChain', () => {
  it('trims subtags progressively', () => {
    assert.deepEqual(defaultFallbackChain('zh-Hant-TW'), ['zh-Hant-TW', 'zh-Hant', 'zh']);
    assert.deepEqual(defaultFallbackChain('en'), ['en']);
  });
});

describe('negotiateLocale', () => {
  const available = ['en', 'en-US', 'fr', 'de'];
  it('prefers exact matches, then primary subtag, then default', () => {
    assert.equal(negotiateLocale('fr-FR,fr;q=0.9', available, 'en'), 'fr'); // primary subtag
    assert.equal(negotiateLocale('en-US', available, 'en'), 'en-US');       // exact
    assert.equal(negotiateLocale(['de'], available, 'en'), 'de');
    assert.equal(negotiateLocale('es', available, 'en'), 'en');             // no match → default
  });
  it('handles the wildcard and empty requests', () => {
    assert.equal(negotiateLocale('*', available, 'en'), 'en'); // first available
    assert.equal(negotiateLocale('', available, 'de'), 'de');  // nothing requested → default
  });
});

// ── Intl formatting ─────────────────────────────────────────────────────────────

describe('Intl formatting', () => {
  it('pluralCategory selects CLDR categories and is safe on bad locales', () => {
    assert.equal(pluralCategory('en', 1), 'one');
    assert.equal(pluralCategory('en', 5), 'other');
    assert.equal(pluralCategory('not-a-locale!!', 5), 'other'); // fallback, no throw
  });
  it('formats numbers, dates, and lists', () => {
    assert.equal(formatNumber('en-US', 1234.5, { style: 'currency', currency: 'USD' }), '$1,234.50');
    const d = formatDate('en-US', Date.UTC(2026, 0, 15), { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' });
    assert.equal(d, '01/15/2026');
    assert.equal(formatList('en', ['a', 'b', 'c'], { type: 'conjunction' }), 'a, b, and c');
  });
});

// ── I18n facade ──────────────────────────────────────────────────────────────────

const catalogs: Record<string, Catalog> = {
  en: {
    greeting: 'Hello, {name}!',
    items: { one: '{count} item', other: '{count} items' },
    'nav.home': 'Home',
    plainCount: 'Count: {count}',
  },
  'en-US': { greeting: 'Howdy, {name}!' },
  fr: { greeting: 'Bonjour, {name} !' },
};

function make(onMissing?: (k: string, l: string) => void): I18n {
  return new I18n({ defaultLocale: 'en', catalogs, onMissing });
}

describe('I18n.t', () => {
  it('requires a defaultLocale', () => {
    assert.throws(() => new I18n({ defaultLocale: '', catalogs: {} }), /defaultLocale is required/);
  });

  it('translates with interpolation and locale selection', () => {
    const i = make();
    assert.equal(i.t('greeting', { name: 'Ada' }), 'Hello, Ada!');
    assert.equal(i.t('greeting', { name: 'Ada' }, 'fr'), 'Bonjour, Ada !');
    assert.equal(i.t('greeting', { name: 'Ada' }, 'en-US'), 'Howdy, Ada!');
  });

  it('falls back along the chain then to the default locale', () => {
    const i = make();
    // en-US has no nav.home → falls back to en.
    assert.equal(i.t('nav.home', {}, 'en-US'), 'Home');
    // Unknown locale → default locale catalog.
    assert.equal(i.t('nav.home', {}, 'de'), 'Home');
  });

  it('returns the key and calls onMissing when unresolved', () => {
    const misses: string[] = [];
    const i = make((k) => misses.push(k));
    assert.equal(i.t('does.not.exist'), 'does.not.exist');
    assert.deepEqual(misses, ['does.not.exist']);
  });

  it('t on a plural entry uses the "other" form', () => {
    const i = make();
    assert.equal(i.t('items', { count: 2 }), '2 items');
  });

  it('has() reports resolvability', () => {
    const i = make();
    assert.equal(i.has('greeting', 'fr'), true);
    assert.equal(i.has('nope'), false);
  });
});

describe('I18n.plural', () => {
  it('selects the plural category and injects {count}', () => {
    const i = make();
    assert.equal(i.plural('items', 1), '1 item');
    assert.equal(i.plural('items', 5), '5 items');
  });

  it('interpolates a non-plural (string) entry with count', () => {
    const i = make();
    assert.equal(i.plural('plainCount', 7), 'Count: 7');
  });

  it('returns the key + calls onMissing when unresolved', () => {
    const misses: string[] = [];
    const i = make((k) => misses.push(k));
    assert.equal(i.plural('missing.plural', 1), 'missing.plural');
    assert.deepEqual(misses, ['missing.plural']);
  });

  it('falls back to "other" when the selected category is absent', () => {
    const i = new I18n({
      defaultLocale: 'en',
      catalogs: { en: { x: { other: '{count} things' } } },
    });
    assert.equal(i.plural('x', 1), '1 things'); // 'one' absent → 'other'
  });
});

describe('I18n formatting + catalogs', () => {
  it('binds formatting to defaultLocale or an override', () => {
    const i = make();
    assert.equal(i.number(1234.5, { minimumFractionDigits: 1 }), '1,234.5');
    assert.equal(i.list(['x', 'y']), 'x and y');
    assert.equal(typeof i.date(Date.UTC(2026, 0, 1), { timeZone: 'UTC' }), 'string');
  });

  it('addCatalog merges and availableLocales reflects it', () => {
    const i = make();
    i.addCatalog('de', { greeting: 'Hallo, {name}!' });
    assert.equal(i.t('greeting', { name: 'Ada' }, 'de'), 'Hallo, Ada!');
    assert.ok(i.availableLocales().includes('de'));
    // Merge (not replace): existing en entries remain after a partial add.
    i.addCatalog('en', { extra: 'x' });
    assert.equal(i.t('greeting', { name: 'A' }), 'Hello, A!');
    assert.equal(i.t('extra'), 'x');
  });
});
