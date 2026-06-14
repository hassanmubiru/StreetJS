// Runnable example for @streetjs/plugin-paypal.
// Prereq: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox). Then: node example/index.mjs

import { PayPalClient } from '../dist/index.js';

const client = new PayPalClient({
  clientId: process.env.PAYPAL_CLIENT_ID ?? 'demo',
  clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? 'demo',
  environment: 'sandbox',
});

const order = await client.createOrder({ amount: '20.00', currency: 'USD' });
console.log('created order:', order);
