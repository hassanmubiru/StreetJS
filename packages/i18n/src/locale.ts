// src/locale.ts
// Locale negotiation and fallback chains. Pure, dependency-free.

/** A parsed Accept-Language entry. */
export interface LanguageRange {
  tag: string;
  quality: number;
}

/**
 * Parse an `Accept-Language` header into ranges sorted by descending quality
 * (stable for equal q). Malformed entries are skipped; `*` is preserved.
 */
export function parseAcceptLanguage(header: string): LanguageRange[] {
  if (typeof header !== 'string' || header.trim() === '') return [];
  const ranges: Array<LanguageRange & { order: number }> = [];
  let order = 0;
  for (const part of header.split(',')) {
    const [rawTag, ...paramParts] = part.trim().split(';');
    const tag = rawTag?.trim();
    if (!tag) continue;
    let quality = 1;
    for (const p of paramParts) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) {
        const q = Number.parseFloat(m[1]!);
        if (Number.isFinite(q)) quality = Math.min(1, Math.max(0, q));
      }
    }
    ranges.push({ tag, quality, order: order++ });
  }
  return ranges
    .sort((a, b) => (b.quality - a.quality) || (a.order - b.order))
    .map(({ tag, quality }) => ({ tag, quality }));
}

/**
 * Build a fallback chain for a locale by trimming trailing subtags:
 * `zh-Hant-TW` → `['zh-Hant-TW', 'zh-Hant', 'zh']`. Comparisons are
 * case-insensitive on the primary subtag but the returned tags preserve input.
 */
export function defaultFallbackChain(locale: string): string[] {
  const parts = locale.split('-').filter((p) => p.length > 0);
  const chain: string[] = [];
  for (let i = parts.length; i >= 1; i -= 1) {
    chain.push(parts.slice(0, i).join('-'));
  }
  return chain.length > 0 ? chain : [locale];
}

/** Case-insensitive tag equality. */
function eq(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Choose the best available locale for a set of requested tags (in preference
 * order). Tries exact matches first, then primary-subtag matches (`en-GB`
 * accepts `en`), then falls back to `defaultLocale`. Accepts either an
 * `Accept-Language` header string or a pre-ordered list of tags.
 */
export function negotiateLocale(
  requested: string | string[],
  available: string[],
  defaultLocale: string,
): string {
  const tags = Array.isArray(requested)
    ? requested
    : parseAcceptLanguage(requested).map((r) => r.tag);

  // 1. Exact (case-insensitive) match in preference order.
  for (const tag of tags) {
    if (tag === '*') return available[0] ?? defaultLocale;
    const exact = available.find((a) => eq(a, tag));
    if (exact) return exact;
  }
  // 2. Primary-subtag match (requested `en-US` accepts available `en`, and
  //    requested `en` accepts available `en-US`).
  for (const tag of tags) {
    const primary = tag.split('-')[0]!;
    const byPrimary = available.find((a) => eq(a.split('-')[0]!, primary));
    if (byPrimary) return byPrimary;
  }
  // 3. Nothing matched.
  return defaultLocale;
}
