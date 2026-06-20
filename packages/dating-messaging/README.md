<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/dating-messaging

Official [StreetJS Framework](https://hassanmubiru.github.io/StreetJS/) dating
reference package providing **messaging between matched users** with
**encrypted message content**, that **refuses delivery while a block exists**
(Phase 10, R11.3/R11.5).

It introduces no independent matching, crypto, or block logic. It composes
three existing primitives:

- **`@streetjs/dating-profiles`** — match state. Messaging is permitted only
  between mutually matched users (R11.3).
- **`@streetjs/core` `FieldCipher`/`EncryptedField`** — message bodies are
  encrypted at rest, never stored in the clear (R11.3, Phase 5/R6).
- **`@streetjs/core` `ModerationToolkit`** — block state. Delivery is refused
  while a block exists between the two users (R11.5, composing R8.3).

## Install

```bash
npm install @streetjs/dating-messaging @streetjs/dating-profiles @streetjs/core
```

## Usage

```ts
import { randomBytes } from 'node:crypto';
import {
  FieldCipher,
  Keyring,
  ModerationToolkit,
  ProfileService,
  MessageService,
} from '@streetjs/dating-messaging';

// Match state (profiles) and block state (moderation) are owned by core/profiles.
const profiles = new ProfileService({ cipher: new FieldCipher(Keyring.fromKey(randomBytes(32))) });
const moderation = new ModerationToolkit();

// A separate cipher encrypts message bodies at rest.
const messages = new MessageService(
  profiles,
  moderation,
  new FieldCipher(Keyring.fromKey(randomBytes(32))),
);

// Two users must be mutually matched before they can message.
await profiles.create({ userId: 'ada', displayName: 'Ada', bio: 'loves hiking' });
await profiles.create({ userId: 'lin', displayName: 'Lin', bio: 'enjoys jazz' });

await messages.send('ada', 'lin', 'hi!');  // { delivered: false, reason: 'NOT_MATCHED' }

await profiles.like('ada', 'lin');
await profiles.like('lin', 'ada');          // reciprocal -> matched

await messages.send('ada', 'lin', 'hi!');  // { delivered: true, message: { ... } }

// A block refuses delivery between the two users (either direction).
await moderation.block('lin', 'ada');       // lin blocks ada
await messages.send('ada', 'lin', 'hi!');  // { delivered: false, reason: 'BLOCKED' }
```

## API

### `new MessageService(profiles, moderation, cipher, options?)`

| Parameter    | Required | Description                                                       |
| ------------ | -------- | ----------------------------------------------------------------- |
| `profiles`   | yes      | A `ProfileService`; messaging requires a mutual match (R11.3).    |
| `moderation` | yes      | A `ModerationToolkit`; a block refuses delivery (R11.5).          |
| `cipher`     | yes      | A `FieldCipher` used to encrypt each message body at rest.        |
| `options.store` | no    | A `MessageStore`. Defaults to `InMemoryMessageStore`.             |
| `options.now`   | no    | Clock injection for deterministic timestamps (tests).            |
| `options.idFactory` | no | Custom message-id generator. Defaults to a random hex id.       |

| Method | Description |
| ------ | ----------- |
| `send(from, to, body)` | Send a message. Returns `{ delivered, reason?, message? }`. Delivered only when the users are matched **and** unblocked. |
| `readBody(message)` | Decrypt and return the plaintext body of a stored message (authorized read). |
| `conversation(a, b)` | All messages exchanged between two users (order-independent). |

### Delivery rules

`send(from, to, body)` is accepted **only** when both hold:

1. `from` and `to` are mutually matched (`ProfileService.isMatch`) — otherwise
   `{ delivered: false, reason: 'NOT_MATCHED' }`.
2. No block relationship exists between them in either direction
   (`ModerationToolkit.canMessage`) — otherwise
   `{ delivered: false, reason: 'BLOCKED' }`.

A block always wins: an existing block prevents delivery even between matched
users (the block-prevents-messaging invariant, Property 18).

### Encrypted bodies

`Message.body` is an `EncryptedField<string>`: the plaintext is never stored.
Use `readBody()` (which calls the core `FieldCipher.decrypt`) for authorized
reads.

### Pluggable storage

`MessageService` persists through the `MessageStore` interface. The bundled
`InMemoryMessageStore` suits tests and single-instance use; supply your own
store for shared, multi-instance deployments.

## Example

A runnable, offline example lives in [`examples/`](./examples):

```bash
npm run build
node examples/index.mjs
```

## Tests

```bash
npm test
```

Unit tests cover match-gated delivery, encrypted bodies, block refusal in
either direction, and input validation. The property-based test
(`*-pbt.test.ts`, added separately) checks the block-prevents-messaging
invariant across arbitrary block sequences (Property 18, R8.3/R11.5).

## License

MIT
