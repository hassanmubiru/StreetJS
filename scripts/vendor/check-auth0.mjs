#!/usr/bin/env node
// scripts/vendor/check-auth0.mjs
// Live Auth0 check (CI, requires AUTH0_* secrets). Performs a real
// client-credentials token request against the tenant's /oauth/token endpoint
// and asserts a token is issued (status 200). Uses a raw `node:https` request
// (matching check-sendgrid.mjs/check-stripe.mjs) rather than importing
// @streetjs/core, since this script runs in a job that never builds the
// (unbuilt-by-design) @streetjs/core compat package.
import { request as httpsRequest } from 'node:https';

const { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_AUDIENCE } = process.env;
if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !AUTH0_CLIENT_SECRET) {
  console.error('AUTH0_DOMAIN/AUTH0_CLIENT_ID/AUTH0_CLIENT_SECRET required'); process.exit(64);
}

const body = JSON.stringify({
  grant_type: 'client_credentials',
  client_id: AUTH0_CLIENT_ID,
  client_secret: AUTH0_CLIENT_SECRET,
  ...(AUTH0_AUDIENCE ? { audience: AUTH0_AUDIENCE } : {}),
});

const status = await new Promise((resolve, reject) => {
  const req = httpsRequest(
    {
      method: 'POST',
      hostname: AUTH0_DOMAIN,
      path: '/oauth/token',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    },
    (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); },
  );
  req.once('error', reject); req.write(body); req.end();
});

console.log(`Auth0 /oauth/token → ${status}`);
if (status !== 200) { console.error('Auth0 token request failed'); process.exit(1); }
console.log('Auth0 authenticated ✓');
