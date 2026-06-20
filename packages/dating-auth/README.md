<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/dating-auth

Consumer-platform **dating authentication** reference package for the
[StreetJS Framework](https://hassanmubiru.github.io/StreetJS/).

This package introduces **no independent authentication logic**. It is a thin
composition layer over three primitives that already ship in `@streetjs/core`
(published as `streetjs`):

| Concern            | Delegated to (core)          |
| ------------------ | ---------------------------- |
| Token issue/verify | `JwtService` (HMAC-SHA256)   |
| Session sealing    | `SessionManager` (AES-256-GCM) |
| Abuse accounting   | `AbuseEngine` (sliding-window counters) |

Credential checking is intentionally **not** done here — the caller decides
whether the presented secret matched (`credentialsValid`) and the service only
orchestrates abuse accounting plus, on a permitted and valid attempt, mints a
token and seals a session.

## Install

```bash
npm install @streetjs/dating-auth
```

## Usage

```ts
import { randomBytes } from 'node:crypto';
import { DatingAuthService } from '@streetjs/dating-auth';

const auth = new DatingAuthService({
  jwtSecret: process.env.JWT_SECRET!,            // ≥ 32 chars
  sessionKey: process.env.SESSION_KEY!,          // 64-char hex (openssl rand -hex 32)
  abuse: {
    config: {
      loginFailureThreshold: 5,
      loginWindowMs: 15 * 60_000,
      lockoutMs: 30 * 60_000,
      signupThreshold: 10,
      signupWindowMs: 60 * 60_000,
      sprayDistinctAccounts: 8,
      sprayWindowMs: 10 * 60_000,
      scoreThreshold: 50,
    },
  },
});

// Your app verifies the password hash, then hands the outcome to the service.
const result = await auth.login({
  ip: req.ip,
  accountId: user.id,
  credentialsValid: await verifyPassword(req.body.password, user.passwordHash),
  payload: { email: user.email, roles: user.roles },
});

if (result.ok) {
  // result.token  -> signed JWT
  // result.session-> sealed (AES-256-GCM) session blob
} else {
  // result.reason -> 'INVALID_CREDENTIALS' | 'LOCKED_OUT' | 'SIGNUP_THROTTLED' | 'SCORE_EXCEEDED'
}
```

## API

- `new DatingAuthService(options)` — wires the three core primitives. Each
  primitive validates its own inputs (JWT secret length, session-key entropy).
- `login(params)` — records the attempt with the `AbuseEngine`; on a permitted
  and valid attempt, issues a JWT and seals a session.
- `signup(ip, ts?)` — per-source signup throttling via the `AbuseEngine`.
- `isLockedOut(accountId, now?)` — current lockout status.
- `issueToken(payload, options?)` / `verifyToken(token, options?)` — delegate to `JwtService`.
- `createSession(data)` / `readSession(blob)` — delegate to `SessionManager`.
- `DatingAuthService.generateCsrf()` / `generateSessionId()` — delegate to `SessionManager`.

All cryptographic material and counters live inside the wrapped core
primitives; this package holds none of its own.

## Configuration

| Key                 | Required | Description                                                    |
| ------------------- | -------- | -------------------------------------------------------------- |
| `jwtSecret`         | yes      | HMAC secret for the wrapped `JwtService` (≥ 32 chars).         |
| `sessionKey`        | yes      | 64-char hex key for the wrapped `SessionManager`.              |
| `abuse.config`      | yes      | Thresholds/windows passed straight through to `AbuseEngine`.   |
| `abuse.store`       | no       | Counter backing (defaults to in-memory; supply a shared store for cross-instance enforcement). |
| `abuse.ipReputation`| no       | IP-reputation hook consulted by the core engine.               |
| `abuse.clock`       | no       | Injected now-provider for deterministic windows (tests).       |
| `jwtOptions`        | no       | Default `JwtService` options (issuer/audience/expiry).         |

## Example

A runnable example lives in [`examples/`](./examples):

```bash
npm run build
node examples/index.mjs
```

## License

MIT
