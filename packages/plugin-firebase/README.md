<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-firebase

Official StreetJS plugin: **Firebase Auth** (Identity Toolkit) REST.

Dependency-free — request construction (Identity Toolkit endpoints with the Web
API key + JSON bodies) is pure and offline-verifiable; the network send uses
`node:https`. Covers email/password sign-up, sign-in, and ID-token lookup.

## Install

```bash
npm install @streetjs/plugin-firebase
# or: street add firebase
```

## Configuration

```ts
import { FirebasePlugin } from '@streetjs/plugin-firebase';

const plugin = new FirebasePlugin({
  apiKey: process.env.FIREBASE_API_KEY, // Firebase Web API key
  stateKey: 'firebase',
});
```

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `apiKey` | string | yes | Firebase Web API key |
| `stateKey` | string | no | request-state key (default `firebase`) |

## Usage

```ts
import type { StreetContext } from 'streetjs';
import type { FirebaseAuthClient } from '@streetjs/plugin-firebase';

const fb = ctx.state['firebase'] as FirebaseAuthClient;
const session = await fb.signIn('user@example.com', 'secret123');
const account = await fb.lookup(session.idToken);
```

`buildSignUpRequest` / `buildSignInRequest` / `buildLookupRequest` are exported as
testable seams; emails are validated with linear (non-backtracking) parsing.

## Security

- **Permissions:** `net`, `secrets`, `middleware`. Ed25519-signed manifest verified on install.
- The Web API key is a public client key; protect accounts with Firebase security
  rules and email-enumeration protection — do not treat it as a secret credential.
- No third-party runtime dependencies.

## License

MIT
