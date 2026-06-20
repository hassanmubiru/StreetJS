<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-clerk

Official StreetJS plugin: **Clerk** identity backend API.

Dependency-free — request construction (bearer secret key + JSON) is pure and
offline-verifiable; the network send uses `node:https`. Covers the common
backend operations (get a user, list users).

## Install

```bash
npm install @streetjs/plugin-clerk
# or: street add clerk
```

## Configuration

```ts
import { ClerkPlugin } from '@streetjs/plugin-clerk';

const plugin = new ClerkPlugin({
  secretKey: process.env.CLERK_SECRET_KEY, // sk_test_… / sk_live_…
  baseUrl: 'https://api.clerk.com/v1',     // optional override
  stateKey: 'clerk',
});
```

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `secretKey` | string | yes | Clerk backend secret key |
| `baseUrl` | string | no | https override |
| `stateKey` | string | no | request-state key (default `clerk`) |

## Usage

```ts
import type { StreetContext } from 'streetjs';
import type { ClerkClient } from '@streetjs/plugin-clerk';

const clerk = ctx.state['clerk'] as ClerkClient;
const user = await clerk.getUser('user_123');
```

`buildGetUserRequest` / `buildListUsersRequest` are exported as testable seams;
user ids are validated (no slashes/whitespace) and URL-encoded before the wire.

## Security

- **Permissions:** `net`, `secrets`, `middleware`. Ed25519-signed manifest verified on install.
- The secret key is sent only as a bearer header to the Clerk backend API.
- No third-party runtime dependencies.

## License

MIT
