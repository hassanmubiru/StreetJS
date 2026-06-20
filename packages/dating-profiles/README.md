<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/dating-profiles

Official [StreetJS Framework](https://hassanmubiru.github.io/StreetJS/) reference
package for **dating profiles, likes, and reciprocal matching** (Phase 10, R11.2).

It composes hardened `@streetjs/core` primitives instead of reinventing them:
profile `bio` values are encrypted at rest with the core
[`FieldCipher`/`EncryptedField`](https://hassanmubiru.github.io/StreetJS/) field-level
encryption (Phase 5, R6), and a **match is recorded the moment two users have
liked each other**.

## Install

```bash
npm install @streetjs/dating-profiles streetjs
```

## Usage

```ts
import { randomBytes } from 'node:crypto';
import { FieldCipher, Keyring } from 'streetjs';
import { ProfileService } from '@streetjs/dating-profiles';

// A versioned keyring backs envelope encryption; rotate by adding versions.
const cipher = new FieldCipher(Keyring.fromKey(randomBytes(32)));
const profiles = new ProfileService({ cipher });

// Create profiles — `bio` is stored as ciphertext, never plaintext.
await profiles.create({ userId: 'ada', displayName: 'Ada', bio: 'loves hiking' });
await profiles.create({ userId: 'lin', displayName: 'Lin', bio: 'enjoys jazz' });

await profiles.like('ada', 'lin'); // { matched: false } — one-sided
await profiles.like('lin', 'ada'); // { matched: true }  — reciprocal → match

await profiles.isMatch('ada', 'lin'); // true (order independent)
await profiles.readBio('ada');        // 'loves hiking' (authorized decrypt)
```

## API

### `new ProfileService(options)`

| Option   | Required | Description                                                        |
| -------- | -------- | ------------------------------------------------------------------ |
| `cipher` | yes      | A core `FieldCipher` used to encrypt each profile `bio` at rest.   |
| `store`  | no       | A `ProfileStore`. Defaults to `InMemoryProfileStore`.              |
| `now`    | no       | Clock injection for deterministic match timestamps (tests).        |

| Method                         | Description                                                            |
| ------------------------------ | ---------------------------------------------------------------------- |
| `create({ userId, displayName, bio })` | Create a profile; `bio` is stored encrypted. Rejects duplicates. |
| `getProfile(userId)`           | Read the stored profile (with the encrypted `bio`).                    |
| `readBio(userId)`              | Decrypt and return the plaintext bio (authorized read).                |
| `like(from, to)`               | Record a directional like; returns `{ matched }` (true on reciprocal). |
| `isMatch(a, b)`                | Whether two users are mutually matched (order independent).            |
| `matches(userId)`              | All matches involving `userId`.                                        |

### Encrypted bios

`Profile.bio` is an `EncryptedField<string>`: the plaintext is never stored. Use
`readBio()` (which calls the core `FieldCipher.decrypt`) for authorized reads.

### Pluggable storage

`ProfileService` persists through the `ProfileStore` interface. The bundled
`InMemoryProfileStore` suits tests and single-instance use; supply your own store
for shared, multi-instance deployments.

## Matching semantics

- `like(from, to)` is **directional** and idempotent.
- A `Match` is recorded **exactly once** when the second (reciprocal) like
  arrives — `like` returns `{ matched: true }` and `isMatch` becomes `true`.
- `isMatch(a, b)` is **order independent**: `isMatch(a, b) === isMatch(b, a)`.
- Self-likes are rejected and never produce a match.

## Example

A runnable example lives in [`examples/`](./examples):

```bash
node examples/index.mjs
```

## Testing

```bash
npm test
```

Unit tests cover encrypted-bio storage and matching edge cases; the
property-based test (`*-pbt.test.ts`) verifies that reciprocal likes always
produce a match across arbitrary user sets (Property 24, R11.2).

## License

MIT
