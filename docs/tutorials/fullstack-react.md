---
layout:    default
title:     "Full-Stack with React"
parent:    "Tutorials"
nav_order: 6
permalink: /tutorials/fullstack-react/
description: "Build a full-stack app with a StreetJS backend and a React frontend using @streetjs/client and @streetjs/react — auth, data fetching, realtime, search, uploads, and AI."
---

# Full-Stack with React

**Level:** Intermediate · **Time:** ~30 minutes · **Prerequisites:** [Your First API](/tutorials/first-api/), basic React

StreetJS is backend-first, but the published `@streetjs/*` packages make a typed
React frontend trivial. The client SDK is framework-agnostic and zero-dependency;
the React package adds hooks on top. None of these add any frontend dependency to
the backend.

---

## 1. Scaffold backend + frontend in one command

```bash
street create my-app --frontend react
cd my-app
```

This produces a StreetJS backend **and** a `web/` Vite + React app already wired
to the backend with a dev proxy. Run them in two terminals:

```bash
# Terminal 1 — backend
npm install && street dev          # http://localhost:3000

# Terminal 2 — frontend
cd web && npm install && npm run dev   # http://localhost:5173
```

Prefer Next.js? Use `--frontend next` for an App Router app backed by
[`@streetjs/next`](https://www.npmjs.com/package/@streetjs/next).

---

## 2. The client + provider

The scaffold sets up the client and provider for you. Here is what it does:

```tsx
// web/src/main.tsx
import { createStreetClient } from '@streetjs/client';
import { StreetProvider } from '@streetjs/react';

const client = createStreetClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',  // proxied to the backend in dev
  credentials: 'include',                        // send cookies for session auth
});

createRoot(document.getElementById('root')!).render(
  <StreetProvider client={client}>
    <App />
  </StreetProvider>,
);
```

`createStreetClient` gives you typed resources, auth, search, uploads, realtime,
and AI streaming from one object — no framework assumptions.

---

## 3. Authentication

`useAuth` wraps login/register/logout and exposes the current session, refreshing
it automatically on success:

```tsx
import { useAuth } from '@streetjs/react';

function LoginPanel() {
  const { session, loading, login, logout } = useAuth();
  if (loading) return <p>Loading…</p>;
  if (session) return <button onClick={() => logout()}>Sign out</button>;
  return (
    <button onClick={() => login({ email: 'a@b.co', password: 'secret' })}>
      Sign in
    </button>
  );
}
```

Don't want to build forms? Drop in the ready-made, accessible components from
[`@streetjs/auth-ui`](https://www.npmjs.com/package/@streetjs/auth-ui):

```tsx
import { LoginForm, RegisterForm, MFASetup } from '@streetjs/auth-ui';

<LoginForm theme="dark" onSuccess={() => location.assign('/')} />
```

---

## 4. Fetching data

`useQuery` runs an async fetcher and exposes `{ data, error, loading, refetch }`.
Use the typed REST resources off the client:

```tsx
import { useQuery, useStreetClient } from '@streetjs/react';

interface Item { id: string; name: string; price: number; }

function Catalog() {
  const client = useStreetClient();
  const { data, loading, error, refetch } = useQuery<Item[]>(
    () => client.resource<Item>('items').list(),
  );

  if (loading) return <p>Loading…</p>;
  if (error) return <p>Failed to load.</p>;
  return (
    <ul>
      {data?.map((i) => <li key={i.id}>{i.name} — ${i.price}</li>)}
      <button onClick={refetch}>Refresh</button>
    </ul>
  );
}
```

Mutations use `useMutation`:

```tsx
import { useMutation, useStreetClient } from '@streetjs/react';

const client = useStreetClient();
const create = useMutation((body: { name: string; price: number }) =>
  client.resource('items').create(body),
);
// create.mutate({ name: 'Widget', price: 9.99 });
```

---

## 5. Realtime, search, uploads, AI

```tsx
import { useChannel, useSearch, useAIChat, useStreetClient } from '@streetjs/react';

// Realtime — subscribe for the lifetime of the component
useChannel<{ text: string }>('room:42', (m) => console.log(m.data.text));

// Search
const results = useSearch<Item[]>('wid');   // re-runs when the query changes

// File upload
const client = useStreetClient();
await client.uploadFile('/uploads', file, { folder: 'avatars' });

// AI streaming chat
const { messages, streaming, send } = useAIChat({ model: 'gpt-4o-mini' });
await send('Summarize the latest orders');
```

For polished AI and admin surfaces, use
[`@streetjs/ai-ui`](https://www.npmjs.com/package/@streetjs/ai-ui) (`Chat`,
`RAGSearch`, `ToolExecutionViewer`) and
[`@streetjs/admin-ui`](https://www.npmjs.com/package/@streetjs/admin-ui)
(`UserManagement`, `RoleManager`, `AuditLogViewer`, `TenantSwitcher`).

---

## 6. Deploy

The scaffold also writes `.github/workflows/ci.yml` that builds both the backend
and the `web/` app. For production, build the frontend (`npm run build` in
`web/`) and serve it as static assets behind the same origin as the API (or a CDN
with the API proxied), so cookies stay first-party. See [Deployment](/deployment/).

---

## Best practices

- Keep `credentials: 'include'` and serve API + web same-origin (or proxy) so
  httpOnly session cookies work and you avoid storing tokens in JS.
- Let hooks own request state; avoid duplicating loading/error flags by hand.
- Reach for the UI kits before hand-rolling auth/AI/admin screens — they are
  accessible, themeable, and dark-mode-ready out of the box.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| 401s in dev | Dev proxy not configured, or `credentials: 'include'` missing — the scaffold sets both. |
| CORS errors | Serve same-origin/proxied, or enable `corsMiddleware` with explicit origins on the backend. |
| `useStreetClient must be used within a <StreetProvider>` | Wrap your tree in `<StreetProvider client={...}>`. |
