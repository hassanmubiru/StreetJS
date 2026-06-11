// Runnable example: messaging between matched users with encrypted bodies,
// refused while a block exists.
//
//   npm run build   # compile src -> dist
//   node examples/index.mjs
//
// Everything here is in-memory and offline — no server, network, or credentials
// are required.

import { randomBytes } from 'node:crypto';
import {
  FieldCipher,
  Keyring,
  ModerationToolkit,
  ProfileService,
  MessageService,
} from '../dist/index.js';

// Match state (profiles) and block state (moderation).
const profiles = new ProfileService({ cipher: new FieldCipher(Keyring.fromKey(randomBytes(32))) });
const moderation = new ModerationToolkit();

// A dedicated cipher encrypts message bodies at rest.
const messages = new MessageService(
  profiles,
  moderation,
  new FieldCipher(Keyring.fromKey(randomBytes(32))),
);

await profiles.create({ userId: 'ada', displayName: 'Ada', bio: 'loves hiking' });
await profiles.create({ userId: 'lin', displayName: 'Lin', bio: 'enjoys jazz' });

// 1) Not matched yet — messaging is refused.
console.log('before match:', await messages.send('ada', 'lin', 'hi!')); // NOT_MATCHED

// 2) Reciprocal likes create a match; messaging is now permitted.
await profiles.like('ada', 'lin');
await profiles.like('lin', 'ada');
const sent = await messages.send('ada', 'lin', 'hey, want to grab coffee?');
console.log('after match delivered?', sent.delivered);
console.log('stored body is ciphertext?', JSON.stringify(sent.message.body).includes('coffee') === false);
console.log('authorized decrypt:', messages.readBody(sent.message));

// 3) A block refuses delivery between the two users (R11.5).
await moderation.block('lin', 'ada'); // lin blocks ada
console.log('after block:', await messages.send('ada', 'lin', 'still there?')); // BLOCKED

// 4) The conversation reflects only delivered messages.
const convo = await messages.conversation('ada', 'lin');
console.log('conversation size:', convo.length);
