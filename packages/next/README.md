<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/next

Next.js helpers for [StreetJS](https://hassanmubiru.github.io/StreetJS/): server and
edge clients plus auth/session/cookie helpers, built on
[`@streetjs/client`](https://www.npmjs.com/package/@streetjs/client). `next` and
`react` are peer dependencies.

```bash
npm install @streetjs/client @streetjs/react @streetjs/next next react
```

## Quick start

```tsx
// app/providers.tsx
'use client';
import { useMemo } from 'react';
import { createStreetClient } from '@streetjs/client';
import { StreetProvider } from '@streetjs/react';

export function Providers({ children }: { children: React.ReactNode }) {
  const client = useMemo(
    () => createStreetClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '', credentials: 'include' }),
    [],
  );
  return <StreetProvider client={client}>{children}</StreetProvider>;
}
```

```ts
// Server Components / route handlers
import { createServerClient, createEdgeClient, parseCookies } from '@streetjs/next';

const client = createServerClient({ baseUrl: process.env.API_URL!, cookies: cookieHeader });
```

Scaffold a full Next.js + StreetJS app: `street create my-app --frontend next`.

> **Status:** `0.1.x` preview — pre-1.0, APIs may change.

## License

MIT
