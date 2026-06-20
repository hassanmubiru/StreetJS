<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/client

Universal, **framework-agnostic, zero-dependency** type-safe client SDK for
StreetJS backends. Tree-shakeable; works in the browser and Node. Consumes your
backend's public HTTP/WebSocket APIs — never StreetJS core internals (RFC 0002).

> **Status: 0.x preview.** Implemented + tested: typed requests, REST resources,
> auth, search, file uploads, realtime channels, and AI streaming.

## Install

```bash
npm install @streetjs/client
```

## Usage

```ts
import { createStreetClient } from '@streetjs/client';

const api = createStreetClient({ baseUrl: '/api' });

// REST resources (convenience): client.<name>.list/get/create/update/remove
const users = await api.users.list();
const u = await api.users.get(1);

// Typed access:
import type { ResourceClient } from '@streetjs/client';
const posts = api.resource<Post>('posts');
const created = await posts.create({ title: 'Hello' });

// Auth
await api.auth.login({ email, password });
const session = await api.auth.session();

// Search
const hits = await api.search('query', { limit: 10 });

// File upload (multipart/form-data)
await api.uploadFile('/files', file, { folder: 'avatars' });

// Realtime (WebSocket channels)
const rt = api.realtime();
rt.connect();
const off = rt.subscribe('room:1', (msg) => console.log(msg.data));
rt.publish('room:1', { text: 'hi' });

// AI streaming (async iterator of text tokens)
for await (const token of api.aiChat({ messages: [{ role: 'user', content: 'Hi' }] })) {
  process.stdout.write(token);
}
```

## Configuration

| Option | Purpose |
|--------|---------|
| `baseUrl` | API base, e.g. `/api` or `https://api.example.com` |
| `fetch` | override fetch (defaults to global `fetch`) |
| `getToken` | returns a bearer token (sync/async) attached as `Authorization` |
| `headers` | default headers on every request |
| `credentials` | fetch credentials mode (`'include'` for cookie auth) |
| `WebSocket` | WebSocket impl for realtime (defaults to global `WebSocket`) |

## Compatibility & footprint

- **Zero runtime dependencies.** Uses platform `fetch`/`WebSocket`/`FormData`.
- Node 20+ (inject `WebSocket` on Node < 22 where the global isn't stable) and
  modern browsers.
- `sideEffects: false` + named ESM exports → tree-shakeable.

## Errors

Non-2xx responses throw `StreetApiError` (`.status`, `.message`, `.body`);
misconfiguration throws `StreetClientError`.

## License

MIT
