#!/usr/bin/env node
// scripts/vendor/check-sendgrid.mjs
// Live SendGrid auth check (CI, requires SENDGRID_API_KEY). Calls the scopes
// endpoint and asserts the key authenticates (not 401/403). No email is sent.
import { request as httpsRequest } from 'node:https';

const key = process.env.SENDGRID_API_KEY;
if (!key) { console.error('SENDGRID_API_KEY not set'); process.exit(64); }

const status = await new Promise((resolve, reject) => {
  const req = httpsRequest(
    { method: 'GET', hostname: 'api.sendgrid.com', path: '/v3/scopes', headers: { authorization: `Bearer ${key}` } },
    (res) => { res.resume(); res.once('end', () => resolve(res.statusCode ?? 0)); },
  );
  req.once('error', reject); req.end();
});

console.log(`SendGrid /v3/scopes → ${status}`);
if (status === 401 || status === 403) { console.error('SendGrid auth failed'); process.exit(1); }
console.log('SendGrid authenticated ✓');
