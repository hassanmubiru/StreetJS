<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/vue

Vue 3 composables for [StreetJS](https://hassanmubiru.github.io/StreetJS/) backends,
built on [`@streetjs/client`](https://www.npmjs.com/package/@streetjs/client). Vue
is a peer dependency.

```bash
npm install @streetjs/client @streetjs/vue vue
```

## Quick start

```ts
import { provideStreetClient, useApi, useAuth, useQuery } from '@streetjs/vue';

// In a root component setup():
provideStreetClient({ baseUrl: '/api', credentials: 'include' });

// In any descendant setup():
const api = useApi();
const { data, loading, refetch } = useQuery(() => api.resource('items').list());
const { session, login, logout } = useAuth();
```

## Composables

`provideStreetClient`, `installStreetClient` (app-level), `useApi`, `useQuery`,
`useSession`, `useAuth`, `useSearch`, `useRealtime`, `useChannel`, `useAI`.

```ts
useChannel('room:42', (m) => console.log(m.data));  // realtime, auto-cleanup on scope dispose
const { messages, streaming, send } = useAI();       // AI streaming
```

For Nuxt, use [`@streetjs/nuxt`](https://www.npmjs.com/package/@streetjs/nuxt).

> **Status:** `0.1.x` preview — pre-1.0, APIs may change.

## License

MIT
