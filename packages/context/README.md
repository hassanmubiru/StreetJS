# @streetjs/context

The StreetJS request/response context: `createContext(req, res, path, query)`
builds a strict `StreetContext` over Node's `http` request/response with
ergonomic responders, a single-write guard, header access, and secure-by-default
cookies. ESM, strict-TypeScript.

This is the standalone home of the context that also backs the `streetjs`
framework's HTTP layer. The framework re-exports this package, so there is a
single source of truth.

## Install

```bash
npm install @streetjs/context
```

## Usage

```ts
import { createContext } from '@streetjs/context';
import { createServer } from 'node:http';

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const query = Object.fromEntries(url.searchParams);
  const ctx = createContext(req, res, url.pathname, query);

  if (ctx.path === '/health') return ctx.json({ status: 'ok' });
  ctx.text('not found', 404);
}).listen(3000);
```

## The context

`StreetContext` exposes the raw `req`/`res` plus:

- **Request:** `path`, `method` (uppercased), `query`, `headers` (lowercased
  keys, array values joined), `body`, `rawBody`, `files`, `startTime`.
- **Mutable slots** that middleware fills in: `params`, `body`, `state`, `user`,
  `files`.
- **Responders:** `json(data, status?)`, `text(data, status?)`,
  `html(data, status?)`, `send(status)`. Each sets appropriate content headers
  (`nosniff` on JSON/HTML) and is guarded by `sent` — the first responder wins,
  later calls are no-ops, preventing double-send crashes.
- **Headers & cookies:** `setHeader(name, value)`, `cookie(name)` (reads and
  URL-decodes a request cookie), `setCookie(name, value, options?)`.

## Cookies

`setCookie` and the exported pure `serializeCookie(name, value, options?)` apply
**secure-by-default** flags:

| Option | Default |
| ------ | ------- |
| `httpOnly` | `true` (emit `HttpOnly`) |
| `secure` | `true` when `NODE_ENV === 'production'`, else omitted |
| `sameSite` | `'Lax'` |

Pass explicit values to override (`httpOnly: false`, `secure: true/false`, a
different `sameSite`). `maxAge`, `path`, and `domain` are appended when set.
Multiple `setCookie` calls append multiple `Set-Cookie` values rather than
overwriting.

```ts
serializeCookie('sid', 'abc', { maxAge: 3600, path: '/' });
// "sid=abc; HttpOnly; SameSite=Lax; Max-Age=3600; Path=/"   (outside production)
```

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/context
```

## License

MIT — see [LICENSE](./LICENSE).
