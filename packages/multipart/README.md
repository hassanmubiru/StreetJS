# @streetjs/multipart

The multipart/form-data foundation for StreetJS: a **streaming parser** that writes
uploaded files directly to disk — never buffering the whole upload in heap.

**Zero runtime dependencies.** Built on Node.js core only, matching the StreetJS minimal,
carefully curated dependency footprint. Generic and reusable by any application.

```bash
npm install @streetjs/multipart
```

> This is the standalone home of the parser that also backs the `streetjs/multipart`
> subpath; the `streetjs` framework re-exports it, so there is a single implementation.

## Usage

```ts
import { MultipartParser } from '@streetjs/multipart';

// In an HTTP handler, given the request's multipart boundary:
const parser = new MultipartParser(boundary, '/var/uploads', 10 * 1024 * 1024); // 10 MB cap
const { fields, files } = await parser.parse(req); // req: IncomingMessage

fields;  // Record<string, string>
files;   // ParsedFile[]: { fieldName, originalName, mimeType, size, path, encoding }
```

## Behavior & safety

- **Streamed to disk** — file bytes are written to the uploads directory in bounded
  chunks; the full upload is never held in the heap.
- **Byte limit enforced before buffering** — the total size is checked as each chunk
  arrives (before concatenation), so a request cannot blow the heap by overshooting the
  limit; exceeding it rejects with `Upload too large` and **cleans up** any partially
  written files.
- **Filename sanitization** — the stored name is `hex(16) + '_' + sanitized`, restricted
  to `[a-zA-Z0-9._-]` and length-capped, so a hostile `filename` (e.g. `../../etc/x`)
  cannot escape the uploads directory. The `originalName` is preserved in the result.
- **Field cap** — non-file fields are truncated at 64 KB.

`BoundedTransform` is also exported: a passthrough stream that errors once a byte cap is
exceeded, handy for guarding arbitrary streams.

## Public API

`MultipartParser` · `BoundedTransform` · `ParsedFile` · `MultipartResult`.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design notes, and
`src/examples/integration.ts` for a runnable example.

## License

MIT © street contributors
