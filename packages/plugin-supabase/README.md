<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-supabase

Official StreetJS plugin: **Supabase** PostgREST data API.

Dependency-free — request construction (apikey + bearer auth, PostgREST query
params and JSON bodies) is pure and offline-verifiable; the network send uses
`node:https`. Covers select and insert against the REST endpoint.

## Install

```bash
npm install @streetjs/plugin-supabase
# or: street add supabase
```

## Configuration

```ts
import { SupabasePlugin } from '@streetjs/plugin-supabase';

const plugin = new SupabasePlugin({
  url: 'https://xyzcompany.supabase.co',
  apiKey: process.env.SUPABASE_SERVICE_ROLE_KEY, // or anon key
  stateKey: 'supabase',
});
```

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `url` | string | yes | project URL (https) |
| `apiKey` | string | yes | anon or service-role key |
| `stateKey` | string | no | request-state key (default `supabase`) |

## Usage

```ts
import type { StreetContext } from 'streetjs';
import type { SupabaseClient } from '@streetjs/plugin-supabase';

const sb = ctx.state['supabase'] as SupabaseClient;
const rows = await sb.select('profiles', { columns: 'id,username', filters: { id: 'eq.42' }, limit: 1 });
await sb.insert('events', { kind: 'signup', user_id: 42 });
```

`buildSelectRequest` / `buildInsertRequest` are exported as testable seams; table
names are validated as identifiers before the wire.

## Security

- **Permissions:** `net`, `secrets`, `middleware`. Ed25519-signed manifest verified on install.
- The key is sent as both `apikey` and bearer headers, per PostgREST. Prefer the
  anon key with Row Level Security for request-scoped access; keep the service
  role key server-side only.
- No third-party runtime dependencies.

## License

MIT
