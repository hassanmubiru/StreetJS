# @streetjs/xss — Architecture

## Goals

- A single, generic input-sanitization primitive for StreetJS and any application.
- Zero runtime dependencies; pure functions; browser-safe.
- Terminating, resource-bounded, and hard to defeat by reconstitution.
- Strongly typed; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  xss.ts     sanitizeString / sanitizeDeep / escapeHtml.
  index.ts   Curated public API.
```

## Extraction & single source of truth

Extracted from `streetjs` core (`security/xss`). Core now depends on `@streetjs/xss` and
its `src/security/xss.ts` re-exports the three functions, while the framework-specific
`xssMiddleware` stays in core (it references core's request context). So the package is
generic and free of framework coupling, and the `streetjs/xss` subpath keeps working
against one implementation — dependency inversion, not duplication or a shim.

## Key design points

- **Fixed-point sanitization.** `sanitizeString` repeats a delete-only pass until the
  output stops changing. Because each pass can only shorten the string, termination is
  guaranteed, and payloads that would "reconstitute" a dangerous token after a bounded
  number of passes (e.g. `<scr<script>ipt>`) are fully neutralized. This closes the
  historical Class-D reconstitution defect.
- **Resource bounds.** Deep sanitization caps recursion depth (32), object keys (500),
  array length (10 000), and string length (1 MB) so hostile input cannot exhaust CPU or
  memory. Keys are sanitized as well as values.
- **Remove vs. encode.** The sanitizers strip dangerous constructs for safe
  storage/processing; `escapeHtml` encodes for HTML display. They are complementary — the
  README documents when to use each, and notes that context-aware output encoding remains
  the correct defense at render time.

## Testing

`node --test`: tag/protocol/event-handler/null-byte stripping, fixed-point reconstitution,
length cap, deep sanitization of nested strings/keys/arrays, depth/array/key bounds,
primitive/nullish passthrough, unsupported-type handling, and full HTML escaping — 100%
coverage (the declaration-only types are excluded).
