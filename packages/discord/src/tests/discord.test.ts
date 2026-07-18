// src/tests/discord.test.ts
// CI-safe: injected fetch for REST; a locally generated Ed25519 keypair for
// interaction verification. No live Discord.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';

import { DiscordClient, verifyDiscordInteraction } from '../index.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function makeFetch(
  responses: Array<{ ok?: boolean; status?: number; body?: string }>,
): { fetch: (u: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>; calls: Captured[] } {
  const calls: Captured[] = [];
  let i = 0;
  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    const c: Captured = { url, method: init.method, headers: init.headers };
    if (init.body !== undefined) c.body = init.body;
    calls.push(c);
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const status = r.status ?? 200;
    const ok = r.ok ?? (status >= 200 && status < 300);
    return { ok, status, text: async () => r.body ?? '' };
  };
  return { fetch, calls };
}

/** Generate an Ed25519 keypair and return the raw public key as hex + a signer. */
function makeSigner(): { publicKeyHex: string; signHex: (msg: string) => string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const publicKeyHex = spkiDer.subarray(spkiDer.length - 32).toString('hex');
  const signHex = (msg: string): string =>
    sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('hex');
  return { publicKeyHex, signHex };
}

test('DiscordClient requires a token', () => {
  assert.throws(() => new DiscordClient({ token: '' }), /token is required/);
});

test('createMessage POSTs JSON with the Bot auth header', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ id: '1', channel_id: '123', content: 'hi' }) },
  ]);
  const discord = new DiscordClient({ token: 'abc', fetch });
  const msg = await discord.createMessage('123', { content: 'hi', tts: false });

  assert.equal(msg.id, '1');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/123/messages');
  assert.equal(calls[0].headers['authorization'], 'Bot abc');
  assert.deepEqual(JSON.parse(calls[0].body!), { content: 'hi', tts: false });
});

test('getChannel GETs, editMessage PATCHes', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ id: '123', type: 0, name: 'general' }) },
    { body: JSON.stringify({ id: '9', channel_id: '123', content: 'edited' }) },
  ]);
  const discord = new DiscordClient({ token: 'abc', fetch });

  const ch = await discord.getChannel('123');
  assert.equal(ch.name, 'general');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/123');

  const edited = await discord.editMessage('123', '9', { content: 'edited' });
  assert.equal(edited.content, 'edited');
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].url, 'https://discord.com/api/v10/channels/123/messages/9');
});

test('deleteMessage and createReaction issue the right verbs and tolerate 204', async () => {
  const { fetch, calls } = makeFetch([
    { status: 204, body: '' },
    { status: 204, body: '' },
  ]);
  const discord = new DiscordClient({ token: 'abc', fetch });

  await discord.deleteMessage('123', '9');
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/123/messages/9');

  await discord.createReaction('123', '9', '👍');
  assert.equal(calls[1].method, 'PUT');
  assert.match(calls[1].url, /\/channels\/123\/messages\/9\/reactions\/.+\/@me$/);
});

test('executeWebhook posts to the webhook path', async () => {
  const { fetch, calls } = makeFetch([{ status: 204, body: '' }]);
  const discord = new DiscordClient({ token: 'abc', fetch });
  await discord.executeWebhook('wid', 'wtoken', { content: 'from webhook' });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://discord.com/api/v10/webhooks/wid/wtoken');
});

test('a non-2xx response throws with the status', async () => {
  const { fetch } = makeFetch([{ status: 403, ok: false, body: '{"message":"Missing Access"}' }]);
  const discord = new DiscordClient({ token: 'abc', fetch });
  await assert.rejects(() => discord.createMessage('123', { content: 'x' }), /403/);
});

test('verifyDiscordInteraction accepts a valid Ed25519 signature', () => {
  const { publicKeyHex, signHex } = makeSigner();
  const timestamp = '1700000000';
  const body = '{"type":1}';
  const signature = signHex(timestamp + body);
  assert.equal(
    verifyDiscordInteraction({ publicKey: publicKeyHex, signature, timestamp, body }),
    true,
  );
});

test('verifyDiscordInteraction rejects tampering, wrong key, and malformed input', () => {
  const { publicKeyHex, signHex } = makeSigner();
  const other = makeSigner();
  const timestamp = '1700000000';
  const body = '{"type":1}';
  const signature = signHex(timestamp + body);

  // Tampered body.
  assert.equal(
    verifyDiscordInteraction({ publicKey: publicKeyHex, signature, timestamp, body: body + ' ' }),
    false,
  );
  // Signature from a different key.
  assert.equal(
    verifyDiscordInteraction({ publicKey: other.publicKeyHex, signature, timestamp, body }),
    false,
  );
  // Missing signature / timestamp.
  assert.equal(verifyDiscordInteraction({ publicKey: publicKeyHex, signature: '', timestamp, body }), false);
  assert.equal(verifyDiscordInteraction({ publicKey: publicKeyHex, signature, timestamp: '', body }), false);
  // Malformed public key (bad length) → false, not a throw.
  assert.equal(verifyDiscordInteraction({ publicKey: 'abcd', signature, timestamp, body }), false);
  // Signature not 64 bytes.
  assert.equal(verifyDiscordInteraction({ publicKey: publicKeyHex, signature: 'deadbeef', timestamp, body }), false);
});
