/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Sender signs and dispatches an event through a fake transport (no network);
 * the "receiver" then verifies the signature exactly as a consumer would.
 */

import {
  WebhookDispatcher,
  verifySignature,
  HEADER_SIGNATURE,
  type WebhookTransport,
  type DeliveryRequest,
} from '../index.js';

async function main(): Promise<void> {
  const secret = 'whsec_example';

  // Capture the delivered request instead of sending it over the network.
  let delivered: DeliveryRequest | undefined;
  const transport: WebhookTransport = {
    async send(request) {
      delivered = request;
      process.stdout.write(`→ POST ${request.url}\n`);
      return { status: 200 };
    },
  };

  const dispatcher = new WebhookDispatcher({ transport, sleep: async () => {} });
  const result = await dispatcher.dispatch(
    { url: 'https://consumer.example/hooks', secret },
    { type: 'user.created', data: { id: 7, email: 'ada@example.com' } },
  );
  process.stdout.write(`delivered=${result.delivered} attempts=${result.attempts} id=${result.id}\n`);

  // Receiver side: verify the signature over the raw body.
  if (delivered) {
    const check = verifySignature(delivered.body, delivered.headers[HEADER_SIGNATURE], secret);
    process.stdout.write(`signature valid=${check.valid}\n`);

    const tampered = verifySignature(delivered.body + 'x', delivered.headers[HEADER_SIGNATURE], secret);
    process.stdout.write(`tampered valid=${tampered.valid} reason=${tampered.reason}\n`);
  }
}

void main();
