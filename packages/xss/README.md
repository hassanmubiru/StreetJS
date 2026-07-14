# @streetjs/xss

The input-sanitization foundation for StreetJS: **dependency-free XSS defenses** — a
fixed-point string sanitizer, bounded recursive deep sanitization, and HTML entity
escaping.

**Zero runtime dependencies.** Pure functions, framework-agnostic and browser-safe,
matching the StreetJS minimal, carefully curated dependency footprint.

```bash
npm install @streetjs/xss
```

> This is the standalone home of the sanitizers that also back the `streetjs/xss`
> subpath; the `streetjs` framework re-exports them (and adds a request middleware around
> `sanitizeDeep`), so there is a single implementation.

## API

```ts
import { sanitizeString, sanitizeDeep, escapeHtml } from '@streetjs/xss';

sanitizeString('<script>alert(1)</script>');   // "scriptalert(1)/script"
sanitizeString('javascript:evil()');            // "evil()"
sanitizeString('onclick=steal()');              // "steal()"

sanitizeDeep({ name: '<b>x</b>', tags: ['<i>a'] }); // recursively cleaned

escapeHtml('<a href="/x">');   // "&lt;a href=&quot;&#x2F;x&quot;&gt;"
```

## Behavior & guarantees

- **`sanitizeString`** removes angle brackets, `javascript:`/`data:`/`vbscript:`
  protocols, `on*=` event-handler attributes, and null bytes. It loops to a **true fixed
  point** — every pass only deletes characters, so it always terminates and cannot be
  defeated by "reconstitution" payloads like `<scr<script>ipt>`. Input longer than 1 MB
  is truncated first.
- **`sanitizeDeep`** applies `sanitizeString` to every string value **and key** in a
  structure, passing numbers/booleans/`null`/`undefined` through and returning `null` for
  unsupported types. It is bounded against hostile input: depth ≤ 32, ≤ 500 keys per
  object, ≤ 10 000 array items.
- **`escapeHtml`** escapes `& < > " ' /` for safe interpolation into HTML.

> `sanitizeString`/`sanitizeDeep` **remove** dangerous constructs (for storing/processing
> untrusted input); `escapeHtml` **encodes** for display. Use `escapeHtml` (or a proper
> templating auto-escape) when rendering into HTML, and prefer context-aware output
> encoding for untrusted data in attributes, URLs, or scripts.

## Public API

`sanitizeString` · `sanitizeDeep` · `escapeHtml`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design notes, and
`src/examples/integration.ts` for a runnable example.

## License

MIT © street contributors
