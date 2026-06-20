<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/nuxt

Nuxt 3 integration for [StreetJS](https://hassanmubiru.github.io/StreetJS/):
re-exports the [`@streetjs/vue`](https://www.npmjs.com/package/@streetjs/vue)
composables and adds a Nuxt plugin factory that provides a StreetJS client to the
whole app. Vue is a peer dependency; no hard `@nuxt/kit` dependency.

```bash
npm install @streetjs/client @streetjs/vue @streetjs/nuxt
```

## Quick start

```ts
// plugins/streetjs.ts
import { defineNuxtPlugin } from '#app';
import { createStreetNuxtPlugin } from '@streetjs/nuxt';

export default defineNuxtPlugin(createStreetNuxtPlugin({ baseUrl: '/api', credentials: 'include' }));
```

Then use the composables anywhere:

```ts
import { useApi, useAuth, useQuery, useChannel } from '@streetjs/nuxt';

const api = useApi();
const { session, login, logout } = useAuth();
```

The client is also exposed as `nuxtApp.$street`.

> **Status:** `0.1.x` preview — pre-1.0, APIs may change.

## License

MIT
