/**
 * @streetjs/xss — the StreetJS input-sanitization foundation.
 *
 * Dependency-free XSS defenses: a fixed-point string sanitizer, bounded
 * recursive deep sanitization, and HTML entity escaping. Framework-agnostic and
 * browser-safe. Public API only.
 *
 * ```ts
 * import { sanitizeString, sanitizeDeep, escapeHtml } from '@streetjs/xss';
 *
 * sanitizeString('<script>alert(1)</script>');   // "scriptalert(1)/script"
 * sanitizeDeep({ name: '<b>x</b>', tags: ['<i>'] });
 * escapeHtml('<a href="/x">');                    // "&lt;a href=&quot;&#x2F;x&quot;&gt;"
 * ```
 *
 * > This is the standalone home of the sanitizers that also back the
 * > `streetjs/xss` subpath; the `streetjs` framework re-exports them (and adds a
 * > request middleware around `sanitizeDeep`), so there is a single implementation.
 */

export { sanitizeString, sanitizeDeep, escapeHtml } from './xss.js';
