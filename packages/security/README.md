# @streetjs/security

The security foundation for StreetJS: a **dependency-free HS256 JWT service**
(sign/verify/decode) with algorithm-confusion protection, timing-safe signature
comparison, and full claim validation.

**Zero runtime dependencies.** Built on Node.js core (`crypto`) only, matching the
StreetJS minimal, carefully curated dependency footprint. Generic and reusable by any
application.

```bash
npm install @streetjs/security
```

> This is the standalone home of the JWT service that also backs `streetjs/security`; the
> `streetjs` framework re-exports it, so there is a single implementation.

## Quick start

```ts
import { JwtService } from '@streetjs/security';

const jwt = new JwtService(process.env.JWT_SECRET!); // >= 32 chars

const token = jwt.sign({ sub: '7', roles: ['admin'] }, { expiresInSeconds: 3600, issuer: 'street' });
const claims = jwt.verify(token, { issuer: 'street' }); // JwtPayload | null
jwt.decode(token); // payload without signature verification (inspection only)
```

## Security properties

- **HS256 only** — verification requires the header to declare exactly `HS256`/`JWT`,
  defeating algorithm-confusion attacks (`alg: none`, RS/HS swaps).
- **Timing-safe** signature comparison via `crypto.timingSafeEqual`.
- **Claim validation** — `exp` (expiry), `nbf` (not-before), `iat` (with a 60s
  clock-skew guard), and optional `iss`/`aud` matching.
- **Fail closed** — any malformed segment, bad signature, or failed claim check returns
  `null`; `verify` never throws.
- **Key check** — the secret must be at least 32 characters.

`sign` stamps `iat` automatically and adds `exp`/`iss`/`aud` from options.

## API

```ts
new JwtService(secret: string);
jwt.sign(payload: JwtPayload, options?: JwtOptions): string;
jwt.verify(token: string, options?: JwtOptions): JwtPayload | null;
jwt.decode(token: string): JwtPayload | null; // no signature check
```

`JwtPayload` requires `sub` and allows standard (`email`, `roles`, `iat`, `exp`, …) and
custom claims. `JwtOptions` = `{ expiresInSeconds?, issuer?, audience? }`.

## Field encryption (data at rest)

AES-256-GCM authenticated encryption for individual values (PII, transcripts,
tokens), with key rotation. Every token is self-describing — it carries the key
id used — so a `KeyRing` can decrypt data written under older keys.

```ts
import { KeyRing, FieldCipher, generateEncryptionKey } from '@streetjs/security';

// Single key:
const cipher = new FieldCipher(process.env.FIELD_KEY!); // 32-byte hex/base64/Buffer
const enc = cipher.encrypt('user@example.com', 'user:42:email'); // optional AAD
cipher.decrypt(enc, 'user:42:email'); // "user@example.com"

// Rotation with a KeyRing:
const ring = new KeyRing([{ id: 'k1', key: process.env.KEY_V1! }]);
const legacy = ring.encrypt('secret');          // written under k1
ring.addKey('k2', generateEncryptionKey());      // k2 becomes primary
ring.encrypt('new');                              // new writes use k2
ring.decrypt(legacy);                             // k1 data still decrypts
```

- **Authenticated** — GCM tag verified on decrypt; tampering, wrong key, or
  mismatched AAD throw `EncryptionError` (`tryDecrypt` returns `null` instead).
- **Non-deterministic** — a fresh random 96-bit IV per call.
- **AAD** binds a ciphertext to a context so it can't be transplanted.
- `generateEncryptionKey()` → a 256-bit hex key; `KeyRing.keyIdOf(token)`
  inspects a token's key id without decrypting.

## Dependency injection

Depends on no container. Exports a `JWT_SERVICE` token (a global `Symbol`):

```ts
import { JWT_SERVICE, JwtService } from '@streetjs/security';
container.register(JWT_SERVICE, new JwtService(secret));
```

## Public API

`JwtService` · `JwtPayload` · `JwtOptions` · `JWT_SERVICE` token.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design notes, and
`src/examples/integration.ts` for a runnable login/verify example.

## License

MIT © street contributors
