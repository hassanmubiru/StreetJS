#!/usr/bin/env node
// scripts/vendor/check-stripe.mjs
// Live Stripe auth check (CI, requires STRIPE_API_KEY). Reads the account
// balance (read-only) and asserts the key authenticates (not 401).
import { request as httpsRequest } from 'node:https';

const key = process.env.STRIPE_API_KEY;
if (!key) { console.error('STRIPE_API_KEY not set'); process.exit(64); }

const status = await new Promise((resolve, reject) => {
  const req = httpsRequest(
    { method: 'GET', hostname: 'api.stripe.com', path: '/v1/balance', headers: { authorization: `Bearer ${key}` } },
    (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); },
  );
  req.once('error', reject); req.end();
});

console.log(`Stripe /v1/balance → ${status}`);
if (status === 401) { console.error('Stripe auth failed'); process.exit(1); }
console.log('Stripe authenticated ✓');
