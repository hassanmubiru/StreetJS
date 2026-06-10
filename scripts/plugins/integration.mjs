#!/usr/bin/env node
// scripts/plugins/integration.mjs
//
// Official Plugin Ecosystem — REAL backing-service integration harness for ONE
// plugin (Requirement 5.9). This is the actual command executed (through
// `CommandRunner`) by verify.mjs; it is also runnable standalone for local
// debugging:
//
//     node scripts/plugins/integration.mjs <pluginId>
//
// Each plugin exercises its real client/adapter against its real backing
// service or test account:
//
//   redis     RESP2 SET/GET/DEL round trip against a real Redis (container)
//   s3        SigV4 PUT → GET → LIST round trip against a real S3 bucket
//   r2        SigV4 PUT → GET round trip against a real Cloudflare R2 bucket
//   twilio    authenticated read-only account fetch (HTTP Basic) — no SMS sent
//   sendgrid  authenticated scopes fetch (Bearer) — no email sent
//   stripe    authenticated balance read (Bearer) — read-only
//   auth0     OAuth2 client-credentials token issuance
//
// Honest BLOCKED: when the backing service is unreachable or the test
// credential is absent, the harness prints a SKIP line and exits 0 — the
// driver's prerequisite probe records the honest BLOCKED for the artifact so
// the offline suite stays green (Testing Strategy → Honest BLOCKED). A genuine
// integration failure exits non-zero.
//
// _Design: Components → Official Plugin Ecosystem; Testing Strategy → Layer B +
//  Honest BLOCKED. Requirements: 5.9_

import { request as httpsRequest } from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';

import {
  S3StorageAdapter,
  R2Client,
  TwilioClient,
  Auth0Client,
} from 'streetjs';

import { REPO_ROOT, resolvePlugin, redisTarget, firstEnv } from './lib.mjs';

/** Assert a condition; throws a labelled Error when it does not hold. */
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** Minimal HTTPS request returning `{ status, body }`. Sends `body` when given. */
function httpsSend({ method, hostname, path, headers, body }) {
  return new Promise((resolveP, reject) => {
    const req = httpsRequest({ method, hostname, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolveP({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.once('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const SHA256_EMPTY = createHash('sha256').update('').digest('hex');
function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

// ── Per-plugin integration actions ─────────────────────────────────────────

/** Redis: connect the plugin's own RESP2 client and round-trip SET/GET/DEL. */
async function integrateRedis() {
  // Import the plugin-under-test's client directly from its built package.
  const { RedisClient } = await import(resolve(REPO_ROOT, 'packages/plugin-redis/dist/index.js'));
  const target = redisTarget();
  const client = new RedisClient({ host: target.host, port: target.port, ...(target.password ? { password: target.password } : {}), timeoutMs: 5_000 });
  await client.connect();
  try {
    const pong = await client.ping();
    assert(pong === 'PONG', `expected PONG, got ${JSON.stringify(pong)}`);

    const key = `street:plugin:redis:itest:${randomBytes(6).toString('hex')}`;
    const value = `v-${randomBytes(4).toString('hex')}`;
    await client.set(key, value, 60);
    const got = await client.get(key);
    assert(got === value, `GET mismatch: expected ${value}, got ${JSON.stringify(got)}`);
    await client.del(key);
    const afterDel = await client.get(key);
    assert(afterDel === null, `DEL did not remove key, got ${JSON.stringify(afterDel)}`);
    console.log('[plugin:redis] SET/GET/DEL round trip OK');
  } finally {
    await client.quit();
  }
}

/** S3: PUT → GET → LIST round trip via the plugin's SigV4 storage adapter. */
async function integrateS3() {
  const adapter = new S3StorageAdapter({
    bucket: firstEnv(['S3_BUCKET']),
    region: firstEnv(['S3_REGION', 'AWS_REGION']),
    accessKeyId: firstEnv(['S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID']),
    secretAccessKey: firstEnv(['S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY']),
    ...(firstEnv(['S3_PREFIX']) ? { prefix: firstEnv(['S3_PREFIX']) } : {}),
  });
  const key = `street-plugin-s3-itest-${randomBytes(6).toString('hex')}.txt`;
  const payload = Buffer.from(`street-s3-${randomBytes(8).toString('hex')}`);

  await adapter.write(key, Readable.from(payload));
  const readStream = await adapter.read(key);
  const chunks = [];
  for await (const c of readStream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const got = Buffer.concat(chunks);
  assert(got.equals(payload), `S3 GET bytes differ from PUT (${got.length} vs ${payload.length})`);

  const listed = await adapter.list();
  assert(listed.some((k) => k.endsWith(key)), `S3 LIST did not include ${key}`);
  console.log('[plugin:s3] PUT/GET/LIST round trip OK');
}

/** R2: SigV4 PUT → GET round trip via the plugin's R2Client against R2's endpoint. */
async function integrateR2() {
  const accountId = firstEnv(['R2_ACCOUNT_ID']);
  const bucket = firstEnv(['R2_BUCKET']);
  const client = new R2Client({
    accountId,
    bucket,
    accessKeyId: firstEnv(['R2_ACCESS_KEY_ID']),
    secretAccessKey: firstEnv(['R2_SECRET_ACCESS_KEY']),
  });
  const host = client.endpoint();
  const key = `street-plugin-r2-itest-${randomBytes(6).toString('hex')}.txt`;
  const payload = Buffer.from(`street-r2-${randomBytes(8).toString('hex')}`);
  const objectPath = `/${bucket}/${key}`.split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/');

  const putHeaders = client.signedObjectHeaders('PUT', key, sha256Hex(payload));
  const put = await httpsSend({ method: 'PUT', hostname: host, path: objectPath, headers: { ...putHeaders, 'content-length': String(payload.length) }, body: payload });
  assert(put.status >= 200 && put.status < 300, `R2 PUT failed (${put.status}): ${put.body.toString('utf8').slice(0, 200)}`);

  const getHeaders = client.signedObjectHeaders('GET', key, SHA256_EMPTY);
  const get = await httpsSend({ method: 'GET', hostname: host, path: objectPath, headers: getHeaders });
  assert(get.status >= 200 && get.status < 300, `R2 GET failed (${get.status})`);
  assert(get.body.equals(payload), 'R2 GET bytes differ from PUT');
  console.log('[plugin:r2] PUT/GET round trip OK');
}

/** Twilio: authenticated read-only account fetch (HTTP Basic). No SMS is sent. */
async function integrateTwilio() {
  const sid = firstEnv(['TWILIO_ACCOUNT_SID']);
  const token = firstEnv(['TWILIO_AUTH_TOKEN']);
  // Reuse the plugin client to construct the exact Basic-auth header it uses.
  const client = new TwilioClient({ accountSid: sid, authToken: token, defaultFrom: '+15550000000' });
  const authHeader = client.buildSendSmsRequest({ to: '+15550000001', body: 'ping' }).headers['authorization'];
  const res = await httpsSend({
    method: 'GET',
    hostname: 'api.twilio.com',
    path: `/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
    headers: { authorization: authHeader },
  });
  assert(res.status !== 401 && res.status !== 403, `Twilio auth failed (${res.status})`);
  assert(res.status >= 200 && res.status < 300, `Twilio account fetch returned ${res.status}`);
  console.log(`[plugin:twilio] authenticated account fetch OK (${res.status})`);
}

/** SendGrid: authenticated scopes fetch (Bearer). No email is sent. */
async function integrateSendGrid() {
  const key = firstEnv(['SENDGRID_API_KEY']);
  const res = await httpsSend({
    method: 'GET',
    hostname: 'api.sendgrid.com',
    path: '/v3/scopes',
    headers: { authorization: `Bearer ${key}` },
  });
  assert(res.status !== 401 && res.status !== 403, `SendGrid auth failed (${res.status})`);
  console.log(`[plugin:sendgrid] authenticated scopes fetch OK (${res.status})`);
}

/** Stripe: authenticated, read-only balance read (Bearer). */
async function integrateStripe() {
  const key = firstEnv(['STRIPE_API_KEY', 'STRIPE_TEST_KEY']);
  const res = await httpsSend({
    method: 'GET',
    hostname: 'api.stripe.com',
    path: '/v1/balance',
    headers: { authorization: `Bearer ${key}` },
  });
  assert(res.status !== 401, `Stripe auth failed (${res.status})`);
  assert(res.status >= 200 && res.status < 300, `Stripe balance read returned ${res.status}`);
  console.log(`[plugin:stripe] authenticated balance read OK (${res.status})`);
}

/** Auth0: OAuth2 client-credentials token issuance via the plugin client. */
async function integrateAuth0() {
  const client = new Auth0Client({
    domain: firstEnv(['AUTH0_DOMAIN']),
    clientId: firstEnv(['AUTH0_CLIENT_ID']),
    clientSecret: firstEnv(['AUTH0_CLIENT_SECRET']),
    ...(firstEnv(['AUTH0_AUDIENCE']) ? { audience: firstEnv(['AUTH0_AUDIENCE']) } : {}),
  });
  const r = client.buildTokenRequest();
  const u = new URL(r.url);
  const res = await httpsSend({
    method: 'POST',
    hostname: u.hostname,
    path: u.pathname,
    headers: { ...r.headers, 'content-length': String(Buffer.byteLength(r.body)) },
    body: r.body,
  });
  assert(res.status === 200, `Auth0 token request failed (${res.status}): ${res.body.toString('utf8').slice(0, 200)}`);
  console.log('[plugin:auth0] client-credentials token issuance OK (200)');
}

/** Map plugin id → integration action. */
const ACTIONS = {
  redis: integrateRedis,
  s3: integrateS3,
  r2: integrateR2,
  twilio: integrateTwilio,
  sendgrid: integrateSendGrid,
  stripe: integrateStripe,
  auth0: integrateAuth0,
};

export async function runIntegration(pluginId) {
  const plugin = resolvePlugin(pluginId);

  // Prerequisite probe: a missing service/credential is an honest SKIP here
  // (exit 0); the driver records the BLOCKED status for the artifact.
  const blocked = await plugin.probe();
  if (blocked) {
    console.log(`[plugin:${pluginId}] SKIP — prerequisite absent: ${blocked.kind}/${blocked.missingPrerequisite}`);
    return { skipped: true, blocked };
  }

  const action = ACTIONS[pluginId];
  assert(typeof action === 'function', `no integration action for plugin '${pluginId}'`);
  await action();
  return { skipped: false };
}

async function main() {
  const pluginId = process.argv[2];
  if (!pluginId) {
    console.error('Usage: node scripts/plugins/integration.mjs <pluginId>');
    process.exitCode = 64;
    return;
  }
  try {
    await runIntegration(pluginId);
    process.exitCode = 0;
  } catch (err) {
    console.error(`[plugin:${pluginId}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
