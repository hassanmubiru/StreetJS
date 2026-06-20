<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/react

React hooks for [StreetJS](https://hassanmubiru.github.io/StreetJS/) backends, built
on [`@streetjs/client`](https://www.npmjs.com/package/@streetjs/client). SSR-safe;
React is a peer dependency.

```bash
npm install @streetjs/client @streetjs/react react
```

## Quick start

```tsx
import { createStreetClient } from '@streetjs/client';
import { StreetProvider, useAuth, useQuery, useStreetClient } from '@streetjs/react';

const client = createStreetClient({ baseUrl: '/api', credentials: 'include' });

function App() {
  return (
    <StreetProvider client={client}>
      <Catalog />
    </StreetProvider>
  );
}

function Catalog() {
  const api = useStreetClient();
  const { data, loading, error, refetch } = useQuery(() => api.resource('items').list());
  if (loading) return <p>Loading…</p>;
  if (error) return <p>Failed.</p>;
  return <button onClick={refetch}>{data?.length} items</button>;
}
```

## Hooks

`useStreetClient`, `useQuery`, `useMutation`, `useSession`, `useAuth`,
`useSearch`, `useRealtime`, `useChannel`, `useAIChat`, plus `<StreetProvider>`.

```tsx
const { session, loading, login, register, logout } = useAuth();
useChannel('room:42', (m) => console.log(m.data));   // realtime
const results = useSearch('query');                    // full-text search
const { messages, streaming, send } = useAIChat();     // AI streaming
```

See the [Full-Stack with React tutorial](https://hassanmubiru.github.io/StreetJS/tutorials/fullstack-react/).

> **Status:** `0.1.x` preview — pre-1.0, APIs may change.

## License

MIT
