// src/examples/integration.ts
// Runnable, no-network example: an in-memory fake fetch stands in for Graph and
// the incoming webhook; a local base64 HMAC demonstrates outgoing verification.

import { TeamsClient, sendIncomingWebhook, computeTeamsSignature, verifyTeamsOutgoingWebhook } from '../index.js';

async function main(): Promise<void> {
  const fakeFetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    if (url.includes('/messages') && init.method === 'POST') {
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 'msg-1' }) };
    }
    if (url.startsWith('https://outlook.office.com/webhook/')) {
      return { ok: true, status: 200, text: async () => '1' };
    }
    return { ok: false, status: 404, text: async () => 'Not Found' };
  };

  const teams = new TeamsClient({ accessToken: 'demo-token', fetch: fakeFetch });
  const msg = await teams.sendChannelMessage('team-1', 'channel-1', '<b>Deploy complete</b>');
  console.log('sent channel message', msg.id);

  await sendIncomingWebhook(
    'https://outlook.office.com/webhook/demo',
    {
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      summary: 'Deploy',
      text: 'Nightly build passed :rocket:',
    },
    { fetch: fakeFetch },
  );
  console.log('posted incoming webhook card');

  // Verify an inbound outgoing-webhook request the way an HTTP handler would.
  const secret = Buffer.from('outgoing-webhook-secret').toString('base64');
  const body = JSON.stringify({ type: 'message', text: '<at>bot</at> status' });
  const authorization = computeTeamsSignature(secret, body);
  console.log('valid outgoing-webhook signature:', verifyTeamsOutgoingWebhook({ secret, body, authorization }));
  console.log('forged outgoing-webhook signature:', verifyTeamsOutgoingWebhook({ secret, body, authorization: 'HMAC deadbeef' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
