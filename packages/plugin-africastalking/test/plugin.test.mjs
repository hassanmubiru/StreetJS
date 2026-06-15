import test from 'node:test';
import assert from 'node:assert/strict';
import * as at from '../dist/index.js';

const cfg = { apiKey: 'k', username: 'sandbox', sandbox: true };
const prod = { apiKey: 'k', username: 'acme' };

test('config validation', async (t) => {
  await t.test('accepts a valid config', () => {
    assert.doesNotThrow(() => at.validateAfricaTalkingConfig(cfg));
  });
  await t.test('rejects missing/invalid apiKey + username', () => {
    assert.throws(() => at.validateAfricaTalkingConfig({}), at.AfricaTalkingError);
    assert.throws(() => at.validateAfricaTalkingConfig({ apiKey: '' , username: 'x' }), /apiKey/);
    assert.throws(() => at.validateAfricaTalkingConfig({ apiKey: 'k' }), /username/);
    assert.throws(() => at.validateAfricaTalkingConfig({ apiKey: 'k', username: 'u', sandbox: 'yes' }), /sandbox/);
    assert.throws(() => at.validateAfricaTalkingConfig({ apiKey: 'k', username: 'u', timeoutMs: -1 }), /timeoutMs/);
  });
});

test('base URL + environment', async (t) => {
  await t.test('sandbox vs production hosts', () => {
    assert.equal(at.baseUrl('api', true), 'https://api.sandbox.africastalking.com/version1');
    assert.equal(at.baseUrl('api', false), 'https://api.africastalking.com/version1');
    assert.equal(at.baseUrl('voice', true), 'https://voice.sandbox.africastalking.com');
    assert.equal(at.baseUrl('payments', false), 'https://payments.africastalking.com');
  });
});

test('SMS request builders', async (t) => {
  await t.test('single send → messaging endpoint + form body', () => {
    const r = at.buildSmsRequest(cfg, { to: '+254700000000', message: 'hi', from: 'AT' });
    assert.equal(r.method, 'POST');
    assert.ok(r.url.endsWith('/messaging'));
    assert.equal(r.headers.apiKey, 'k');
    const p = new URLSearchParams(r.body);
    assert.equal(p.get('to'), '+254700000000');
    assert.equal(p.get('message'), 'hi');
    assert.equal(p.get('username'), 'sandbox');
    assert.equal(p.get('from'), 'AT');
  });
  await t.test('array recipients are comma-joined', () => {
    const r = at.buildSmsRequest(cfg, { to: ['+254700000000', '+254711111111'], message: 'hi' });
    assert.equal(new URLSearchParams(r.body).get('to'), '+254700000000,+254711111111');
  });
  await t.test('bulk send sets bulkSMSMode', () => {
    const r = at.buildBulkSmsRequest(cfg, { recipients: ['+254700000000'], message: 'promo' });
    assert.equal(new URLSearchParams(r.body).get('bulkSMSMode'), '1');
  });
  await t.test('rejects missing message/recipients', () => {
    assert.throws(() => at.buildSmsRequest(cfg, { to: '', message: 'x' }), /to/);
    assert.throws(() => at.buildSmsRequest(cfg, { to: '+254', message: '' }), /message/);
    assert.throws(() => at.buildBulkSmsRequest(cfg, { recipients: [], message: 'x' }), /recipients/);
  });
});

test('Airtime request builder', async (t) => {
  await t.test('encodes amount as "<CCY> <amount>"', () => {
    const r = at.buildAirtimeRequest(cfg, { phoneNumber: '+254700000000', amount: 100, currencyCode: 'KES' });
    assert.ok(r.url.endsWith('/airtime/send'));
    const recipients = JSON.parse(new URLSearchParams(r.body).get('recipients'));
    assert.deepEqual(recipients, [{ phoneNumber: '+254700000000', amount: 'KES 100' }]);
  });
  await t.test('validates inputs', () => {
    assert.throws(() => at.buildAirtimeRequest(cfg, { phoneNumber: '', amount: 1, currencyCode: 'KES' }), /phoneNumber/);
    assert.throws(() => at.buildAirtimeRequest(cfg, { phoneNumber: '+254', amount: 0, currencyCode: 'KES' }), /amount/);
    assert.throws(() => at.buildAirtimeRequest(cfg, { phoneNumber: '+254', amount: 1, currencyCode: 'KESH' }), /currencyCode/);
  });
});

test('Voice', async (t) => {
  await t.test('outbound call → voice host', () => {
    const r = at.buildCallRequest(prod, { from: '+254700000000', to: '+254711111111' });
    assert.equal(r.url, 'https://voice.africastalking.com/call');
    assert.equal(new URLSearchParams(r.body).get('from'), '+254700000000');
  });
  await t.test('callback validation honours a shared secret', () => {
    assert.deepEqual(at.validateVoiceCallback({ sessionId: 's' }), { sessionId: 's' });
    assert.throws(() => at.validateVoiceCallback({}, { expectedSecret: 'a', providedSecret: 'b' }), /secret mismatch/);
  });
});

test('Mobile Money request builders', async (t) => {
  await t.test('checkout → payments host JSON body', () => {
    const r = at.buildCheckoutRequest(prod, { productName: 'Store', phoneNumber: '+254700000000', currencyCode: 'KES', amount: 500 });
    assert.equal(r.url, 'https://payments.africastalking.com/mobile/checkout/request');
    assert.equal(r.headers['Content-Type'], 'application/json');
    const body = JSON.parse(r.body);
    assert.equal(body.amount, 500);
    assert.equal(body.username, 'acme');
  });
  await t.test('b2c + transaction status + callback verify', () => {
    const b = at.buildB2CRequest(prod, 'Store', [{ phoneNumber: '+254700000000', currencyCode: 'KES', amount: 100 }]);
    assert.ok(b.url.endsWith('/mobile/b2c/request'));
    const s = at.buildTransactionStatusRequest(prod, { transactionId: 'ATX123' });
    assert.equal(JSON.parse(s.body).transactionId, 'ATX123');
    assert.throws(() => at.verifyMobileMoneyCallback({}, { expectedSecret: 'a', providedSecret: 'b' }), /secret mismatch/);
  });
});

test('USSD router', async (t) => {
  const router = at.createUssdRouter()
    .menu('CON Welcome\n1. Balance\n2. Airtime')
    .input('1', () => at.end('Balance: KES 500'))
    .input('2', (_r, segs) => (segs.length === 1 ? at.con('Enter amount:') : at.end(`Buying KES ${segs[1]}`)))
    .end('Invalid choice.');

  await t.test('root menu when no input', () => {
    assert.equal(router.handle({ sessionId: 's', serviceCode: '*1#', phoneNumber: '+254', text: '' }),
      'CON CON Welcome\n1. Balance\n2. Airtime'.replace('CON CON', 'CON'));
  });
  await t.test('routes top-level choices and nested input', () => {
    assert.equal(router.handle({ sessionId: 's', serviceCode: '*1#', phoneNumber: '+254', text: '1' }), 'END Balance: KES 500');
    assert.equal(router.handle({ sessionId: 's', serviceCode: '*1#', phoneNumber: '+254', text: '2' }), 'CON Enter amount:');
    assert.equal(router.handle({ sessionId: 's', serviceCode: '*1#', phoneNumber: '+254', text: '2*50' }), 'END Buying KES 50');
  });
  await t.test('fallback for unknown choice', () => {
    assert.equal(router.handle({ sessionId: 's', serviceCode: '*1#', phoneNumber: '+254', text: '9' }), 'END Invalid choice.');
  });
  await t.test('con/end helpers prefix correctly', () => {
    assert.deepEqual(at.con('x'), { type: 'CON', message: 'x' });
    assert.deepEqual(at.end('y'), { type: 'END', message: 'y' });
  });
});

test('execution: send/retry/timeout/secret-safety (mocked fetch)', async (t) => {
  await t.test('successful SMS send parses JSON', async () => {
    const plugin = at.createAfricaTalkingPlugin({
      ...cfg,
      fetch: async () => new Response(JSON.stringify({ SMSMessageData: { Message: 'Sent' } }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    const res = await plugin.sms.send({ to: '+254700000000', message: 'hi' });
    assert.equal(res.SMSMessageData.Message, 'Sent');
  });

  await t.test('retries transient 500 then succeeds', async () => {
    let calls = 0;
    const plugin = at.createAfricaTalkingPlugin({
      ...cfg, retries: 2,
      fetch: async () => {
        calls++;
        if (calls < 2) return new Response('busy', { status: 503 });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const r = await plugin.airtime.send({ phoneNumber: '+254700000000', amount: 10, currencyCode: 'KES' });
    assert.equal(r.ok, true);
    assert.equal(calls, 2);
  });

  await t.test('non-transient 4xx throws AfricaTalkingError (no retry)', async () => {
    let calls = 0;
    const plugin = at.createAfricaTalkingPlugin({
      ...cfg, retries: 3,
      fetch: async () => { calls++; return new Response(JSON.stringify({ message: 'bad' }), { status: 400, headers: { 'content-type': 'application/json' } }); },
    });
    await assert.rejects(() => plugin.sms.send({ to: '+254', message: 'x' }), at.AfricaTalkingError);
    assert.equal(calls, 1);
  });

  await t.test('errors never leak the api key', async () => {
    const plugin = at.createAfricaTalkingPlugin({
      apiKey: 'SUPER_SECRET_KEY', username: 'acme', retries: 0,
      fetch: async () => new Response('nope', { status: 401, headers: { 'content-type': 'text/plain' } }),
    });
    try {
      await plugin.sms.send({ to: '+254', message: 'x' });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(!String(e.message).includes('SUPER_SECRET_KEY'), 'api key must not appear in error');
    }
  });

  await t.test('timeout aborts and surfaces as AfricaTalkingError', async () => {
    const plugin = at.createAfricaTalkingPlugin({
      ...cfg, timeoutMs: 20, retries: 0,
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    });
    await assert.rejects(() => plugin.sms.send({ to: '+254', message: 'x' }), at.AfricaTalkingError);
  });
});

test('plugin shape + manifest', async (t) => {
  await t.test('default export is a PluginModule subclass with name/version', () => {
    const plugin = at.createAfricaTalkingPlugin(cfg);
    assert.equal(plugin.name, 'street-plugin-africastalking');
    assert.equal(plugin.version, '1.0.0');
    assert.equal(plugin.sandbox, true);
    for (const svc of ['sms', 'voice', 'airtime', 'mobileMoney']) assert.ok(plugin[svc], `has ${svc}`);
    assert.equal(typeof plugin.createUssdRouter, 'function');
  });
  await t.test('africaTalkingPluginManifest matches manifest.json shape', () => {
    const m = at.africaTalkingPluginManifest();
    assert.equal(m.name, 'street-plugin-africastalking');
    assert.deepEqual(m.permissions, ['net', 'secrets', 'middleware']);
    assert.ok(m.capabilities.includes('mobile-money'));
  });
});
