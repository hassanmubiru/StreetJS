// tests/plugins-official.test.ts
// Verifies the Stripe, Twilio, Auth0, and R2 official plugins: config schema,
// deterministic request building (auth + body/signing), and signed install +
// enable through the PluginHost. Offline only.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { PluginHost, signManifest, PluginPermissionError } from '../platform/plugins/host.js';
import { StripePlugin, StripeClient, stripePluginManifest, validateStripeConfig, STRIPE_PLUGIN_NAME } from '../platform/plugins/official/stripe.js';
import { TwilioPlugin, TwilioClient, twilioPluginManifest, validateTwilioConfig, TWILIO_PLUGIN_NAME } from '../platform/plugins/official/twilio.js';
import { Auth0Plugin, Auth0Client, auth0PluginManifest, validateAuth0Config, AUTH0_PLUGIN_NAME } from '../platform/plugins/official/auth0.js';
import { R2Plugin, R2Client, r2PluginManifest, validateR2Config, R2_PLUGIN_NAME } from '../platform/plugins/official/r2.js';
import type { PluginModule } from '../platform/plugins/sdk.js';
import type { PluginManifest } from '../platform/plugins/host.js';

async function installAndEnable(plugin: PluginModule, manifest: PluginManifest): Promise<PluginHost> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const host = new PluginHost({ grantedPermissions: ['net', 'secrets', 'middleware'], publicKey });
  host.register(plugin, signManifest(manifest, privateKey));
  await host.enable(plugin.name);
  return host;
}

describe('Stripe plugin', () => {
  const client = new StripeClient({ apiKey: 'sk_test_123' });
  it('validates config', () => {
    assert.equal(validateStripeConfig({ apiKey: 'sk' }).apiKey, 'sk');
    assert.throws(() => validateStripeConfig({}), /apiKey.*required/);
  });
  it('builds a form-encoded PaymentIntent request with bearer auth', () => {
    const r = client.buildCreatePaymentIntent(2000, 'usd');
    assert.equal(r.url, 'https://api.stripe.com/v1/payment_intents');
    assert.equal(r.headers['authorization'], 'Bearer sk_test_123');
    assert.equal(r.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(r.body, 'amount=2000&currency=usd');
  });
  it('rejects non-positive amounts', () => {
    assert.throws(() => client.buildCreatePaymentIntent(0, 'usd'), /positive integer/);
  });
  it('installs + enables through the host', async () => {
    const host = await installAndEnable(new StripePlugin({ apiKey: 'sk' }), stripePluginManifest());
    assert.equal(host.state(STRIPE_PLUGIN_NAME), 'enabled');
    assert.deepEqual(host.findByCapability('payments'), [STRIPE_PLUGIN_NAME]);
  });
});

describe('Twilio plugin', () => {
  const client = new TwilioClient({ accountSid: 'AC123', authToken: 'tok', defaultFrom: '+15550001111' });
  it('validates config', () => {
    assert.throws(() => validateTwilioConfig({ accountSid: 'AC' }), /authToken.*required/);
  });
  it('builds a Basic-auth, form-encoded SMS request', () => {
    const r = client.buildSendSmsRequest({ to: '+15552223333', body: 'hi' });
    assert.equal(r.url, 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    assert.equal(r.headers['authorization'], `Basic ${Buffer.from('AC123:tok').toString('base64')}`);
    const form = new URLSearchParams(r.body);
    assert.equal(form.get('To'), '+15552223333');
    assert.equal(form.get('From'), '+15550001111');
    assert.equal(form.get('Body'), 'hi');
  });
  it('requires from/to/body', () => {
    assert.throws(() => new TwilioClient({ accountSid: 'A', authToken: 't' }).buildSendSmsRequest({ to: '+1', body: 'x' }), /no "from"/);
    assert.throws(() => client.buildSendSmsRequest({ to: '', body: 'x' }), /"to" is required/);
  });
  it('installs + enables through the host', async () => {
    const host = await installAndEnable(new TwilioPlugin({ accountSid: 'AC', authToken: 't' }), twilioPluginManifest());
    assert.equal(host.state(TWILIO_PLUGIN_NAME), 'enabled');
  });
});

describe('Auth0 plugin', () => {
  it('validates + normalizes the domain (strips protocol/slash)', () => {
    const cfg = validateAuth0Config({ domain: 'https://acme.auth0.com/', clientId: 'c', clientSecret: 's' });
    assert.equal(cfg.domain, 'acme.auth0.com');
  });
  it('builds a client-credentials token request (JSON body)', () => {
    const client = new Auth0Client({ domain: 'acme.auth0.com', clientId: 'cid', clientSecret: 'sec', audience: 'https://api/' });
    const r = client.buildTokenRequest();
    assert.equal(r.url, 'https://acme.auth0.com/oauth/token');
    assert.equal(r.headers['content-type'], 'application/json');
    const body = JSON.parse(r.body);
    assert.equal(body.grant_type, 'client_credentials');
    assert.equal(body.client_id, 'cid');
    assert.equal(body.audience, 'https://api/');
  });
  it('requires an audience', () => {
    const client = new Auth0Client({ domain: 'd', clientId: 'c', clientSecret: 's' });
    assert.throws(() => client.buildTokenRequest(), /no audience/);
  });
  it('installs + enables through the host', async () => {
    const host = await installAndEnable(new Auth0Plugin({ domain: 'acme.auth0.com', clientId: 'c', clientSecret: 's' }), auth0PluginManifest());
    assert.equal(host.state(AUTH0_PLUGIN_NAME), 'enabled');
  });
});

describe('R2 plugin (S3-compatible SigV4)', () => {
  const client = new R2Client({ accountId: 'acct1', bucket: 'media', accessKeyId: 'AK', secretAccessKey: 'SK' });
  const fixed = new Date('2025-01-01T00:00:00.000Z');
  it('validates config', () => {
    assert.throws(() => validateR2Config({ accountId: 'a' }), /bucket.*required/);
  });
  it('signs an object request against the R2 endpoint deterministically', () => {
    const h1 = client.signedObjectHeaders('GET', 'file.bin', undefined, fixed);
    const h2 = client.signedObjectHeaders('GET', 'file.bin', undefined, fixed);
    assert.equal(client.endpoint(), 'acct1.r2.cloudflarestorage.com');
    assert.match(h1['authorization']!, /^AWS4-HMAC-SHA256 Credential=AK\/20250101\/auto\/s3\/aws4_request/);
    assert.match(h1['authorization']!, /Signature=[0-9a-f]{64}$/);
    assert.equal(h1['authorization'], h2['authorization']); // deterministic
  });
  it('changes signature with the key', () => {
    const a = client.signedObjectHeaders('GET', 'a', undefined, fixed)['authorization'];
    const b = client.signedObjectHeaders('GET', 'b', undefined, fixed)['authorization'];
    assert.notEqual(a, b);
  });
  it('installs + enables through the host', async () => {
    const host = await installAndEnable(new R2Plugin({ accountId: 'x', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'SK' }), r2PluginManifest());
    assert.equal(host.state(R2_PLUGIN_NAME), 'enabled');
    assert.deepEqual(host.findByCapability('object-storage'), [R2_PLUGIN_NAME]);
  });
});

describe('official plugins — permission gating', () => {
  it('each refuses to enable without granted permissions', async () => {
    for (const [plugin, manifest] of [
      [new StripePlugin({ apiKey: 'k' }), stripePluginManifest()],
      [new TwilioPlugin({ accountSid: 'A', authToken: 't' }), twilioPluginManifest()],
      [new Auth0Plugin({ domain: 'd', clientId: 'c', clientSecret: 's' }), auth0PluginManifest()],
      [new R2Plugin({ accountId: 'x', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'SK' }), r2PluginManifest()],
    ] as const) {
      const host = new PluginHost({ grantedPermissions: ['net'] }); // missing secrets+middleware
      host.register(plugin, manifest);
      await assert.rejects(() => host.enable(plugin.name), PluginPermissionError);
    }
  });
});
