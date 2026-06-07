#!/usr/bin/env node
// scripts/vendor/check-auth0.mjs
// Live Auth0 check (CI, requires AUTH0_* secrets). Uses the Auth0Client to build
// a client-credentials token request and asserts a token is issued (status 200).
import { Auth0Client } from '@streetjs/core';

const { AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_AUDIENCE } = process.env;
if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID || !AUTH0_CLIENT_SECRET) {
  console.error('AUTH0_DOMAIN/AUTH0_CLIENT_ID/AUTH0_CLIENT_SECRET required'); process.exit(64);
}

const client = new Auth0Client({
  domain: AUTH0_DOMAIN, clientId: AUTH0_CLIENT_ID, clientSecret: AUTH0_CLIENT_SECRET,
  ...(AUTH0_AUDIENCE ? { audience: AUTH0_AUDIENCE } : {}),
});
const status = await client.getToken();
console.log(`Auth0 /oauth/token → ${status}`);
if (status !== 200) { console.error('Auth0 token request failed'); process.exit(1); }
console.log('Auth0 authenticated ✓');
