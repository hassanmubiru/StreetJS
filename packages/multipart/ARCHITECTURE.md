# @streetjs/multipart — Architecture

## Goals

- A single, generic streaming multipart/form-data parser for StreetJS.
- Zero runtime dependencies (Node core: fs, path, crypto, stream, http types).
- Never buffer a full upload in the heap; enforce limits before buffering.
- Strongly typed; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  parser.ts  MultipartParser + BoundedTransform + internal helpers.
  index.ts   Curated public API.
```

## Extraction & single source of truth

Extracted from `streetjs` core (`multipart/parser`). Core now depends on
`@streetjs/multipart` and its `src/multipart/parser.ts` re-exports from it, so the
`streetjs/multipart` subpath and all internal imports resolve to one implementation
(dependency inversion — not duplication, not a shim). The `UploadGuard` policy layer
stays in core.

## Parsing model

`parse(req)` attaches `data`/`end`/`error` listeners and accumulates a working buffer.
Each `data` chunk:

1. adds to a running `totalBytes` and rejects **before** concatenation if it would exceed
   `maxBytes` (heap-safety), destroying the request;
2. concatenates into the buffer and repeatedly extracts complete parts. A part is
   complete once its trailing boundary is present: the header block (up to `\r\n\r\n`) is
   parsed, the body is the bytes up to two before the next boundary, and a
   `Content-Disposition` `filename` selects the file branch (stream to disk) vs. the
   field branch (captured in memory, 64 KB cap).

Files are written via a chunked writer that respects backpressure (`drain`). On any
failure the outer handler unlinks every file created during the request.

## Safety properties

- **Heap-bounded** — the byte cap is checked per chunk before buffering; file bytes go to
  disk in ≤ 64 KB writes.
- **Path containment** — stored names are `randomHex(16) + '_' + sanitize(filename)` with
  the charset restricted to `[a-zA-Z0-9._-]` and length-capped, so directory-traversal
  filenames cannot escape the uploads directory.
- **Cleanup** — partially written files are removed if the upload is rejected mid-stream.

## Testing

`node --test` with a request-like `Readable` (body pushed, EOF on a later tick — faithful
to a socket, unlike `Readable.from` which emits `end` synchronously and races the parser's
async per-chunk writes): field + file parsing, field-only parts, oversize rejection,
filename sanitization/containment, mime/encoding defaults, multiple parts, large files
(exercising the writer's `drain`), partial-file cleanup on late over-limit, stream-error
rejection, and `BoundedTransform`. Coverage: lines/functions/statements ≥ 90, branches
≥ 83 — the single uncovered branch is a defensive parse-error `catch` that the parser's
return-rather-than-throw design makes unreachable via normal or malformed input.
