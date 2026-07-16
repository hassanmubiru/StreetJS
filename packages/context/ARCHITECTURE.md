# Architecture — @streetjs/context

## Purpose

`@streetjs/context` defines the `StreetContext` — the single request/response
object threaded through every StreetJS middleware and handler. It is the seam
between raw Node HTTP and the framework's routing/handler layer, so it lives low
in the graph (only the router and HTTP server sit above it).

## Dependencies

```
node:http           (IncomingMessage / ServerResponse — types only)
@streetjs/multipart (ParsedFile — the shape of an uploaded file, type only)
```

Both dependencies are **type-only**; there is no runtime coupling beyond Node
core. `@streetjs/multipart` is already a published leaf, so no cycle is
introduced.

## Design

### A single factory, no class

`createContext(req, res, path, query)` returns a plain object implementing
`StreetContext`. Response state is closed over a single `_sent` boolean rather
than stored on the object, so it can't be mutated from outside.

### Single-write guard

Every responder (`json`/`text`/`html`/`send`) checks and sets `_sent`. The first
one to run writes the response; subsequent calls are silent no-ops. This makes
double-send bugs (a common source of `ERR_HTTP_HEADERS_SENT` crashes) impossible
from handler code, and `sent` is exposed read-only so middleware can branch on it.

### Header normalization

Incoming headers are copied into a new record with **lowercased keys**; array
values (e.g. repeated headers) are joined with `, `; `undefined` values are
dropped. The original `req.headers` remains available via `ctx.req`.

### Secure-by-default cookies

`serializeCookie` is a pure function (exported for direct testing) that resolves
`httpOnly`/`secure`/`sameSite` defaults and emits attributes in a fixed order for
deterministic output. `secure` defaults to on only under
`NODE_ENV === 'production'`, so local development isn't broken by `Secure`
cookies over HTTP, while production is safe by default. `setCookie` appends to any
existing `Set-Cookie` header (coalescing a prior string into an array) so
multiple cookies accumulate instead of overwriting.

## Testing

The suite runs with **no real socket** using fake `req`/`res` objects that record
`writeHead`/`end`/`setHeader`/`getHeader`. It covers method/header normalization,
every responder and its content headers, the single-write guard, cookie
read/decode, multi-cookie accumulation, string-header coalescing, and the full
`serializeCookie` flag matrix (including the production `Secure` branch via a
scoped `NODE_ENV`). Coverage is 100% lines/functions and ≥97% branches.

## Non-goals

- No routing, body parsing, or middleware pipeline — those consume the context.
- No response compression or streaming helpers beyond the raw `res`.
- No session or auth logic; `user` is a slot other layers populate.
