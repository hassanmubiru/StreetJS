/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Enqueues webhook events and shows the SSRF guard rejecting a private-network
 * target. (Delivery to a real endpoint requires an HTTPS URL; here we only
 * demonstrate the queue + validation without a live receiver.)
 */

import { WebhookDispatcher } from '../index.js';

async function main(): Promise<void> {
  const dispatcher = new WebhookDispatcher();

  // A public HTTPS target is accepted into the queue (delivery is attempted
  // asynchronously; there's no live receiver in this example).
  const accepted = dispatcher.enqueue(
    { url: 'https://example.com/webhooks', secret: 'shared-secret' },
    'order.created',
    { orderId: 'ord_123', total: 4200 },
  );
  process.stdout.write(`public target enqueued: ${accepted}\n`);

  // An http:// (non-TLS) or private-network target is validated out and dropped
  // asynchronously (watch for the validation error on stderr).
  dispatcher.enqueue({ url: 'http://insecure.example', secret: 's' }, 'x', {});
  dispatcher.enqueue({ url: 'https://169.254.169.254/latest/meta-data', secret: 's' }, 'x', {});

  await new Promise((r) => setTimeout(r, 50));
  dispatcher.stop();
  process.stdout.write('dispatcher stopped\n');
}

void main();
