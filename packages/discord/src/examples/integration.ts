// src/examples/integration.ts
// Runnable, no-network example: an in-memory fake fetch stands in for Discord,
// and a locally generated Ed25519 keypair demonstrates interaction verification.

import { generateKeyPairSync, sign } from 'node:crypto';
import { DiscordClient, verifyDiscordInteraction } from '../index.js';

async function main(): Promise<void> {
  const fakeFetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    if (url.endsWith('/messages') && init.method === 'POST') {
      const input = JSON.parse(init.body ?? '{}');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: '555', channel_id: '123', content: input.content }),
      };
    }
    return { ok: false, status: 404, text: async () => '{"message":"Unknown Channel"}' };
  };

  const discord = new DiscordClient({ token: 'demo-token', fetch: fakeFetch });
  const msg = await discord.createMessage('123', { content: 'Deploy complete :rocket:' });
  console.log('sent message', msg.id, '→', msg.content);

  // Verify an inbound interaction the way an HTTP handler would.
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const publicKeyHex = spkiDer.subarray(spkiDer.length - 32).toString('hex');

  const timestamp = '1700000000';
  const body = JSON.stringify({ type: 1 }); // Discord PING
  const signature = sign(null, Buffer.from(timestamp + body, 'utf8'), privateKey).toString('hex');

  console.log('valid interaction signature:', verifyDiscordInteraction({ publicKey: publicKeyHex, signature, timestamp, body }));
  console.log('forged interaction signature:', verifyDiscordInteraction({ publicKey: publicKeyHex, signature: '00'.repeat(64), timestamp, body }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
