// Runnable example: register the Stripe plugin on a PluginHost with enforced
// signature verification, then build (offline) a Stripe PaymentIntent request.
//
//   node example/index.mjs
//
// No network call and no real credentials are needed — buildCreatePaymentIntent
// is pure, so this demonstrates the plugin end-to-end offline.

import { generateKeyPairSync } from 'node:crypto';
import { PluginHost, signManifest, StripeClient } from 'streetjs';
import StripePlugin, { stripePluginManifest } from '@streetjs/plugin-stripe';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new StripePlugin({ apiKey: 'sk_test_123' });

host.register(plugin, signManifest(stripePluginManifest(), privateKey));
await host.enable(plugin.name);
console.log('Stripe plugin enabled:', host.has(plugin.name));

const client = new StripeClient({ apiKey: 'sk_test_123' });
const req = client.buildCreatePaymentIntent(1999, 'usd');
console.log('Request:', req.method, req.url);
console.log('Body:', req.body);
