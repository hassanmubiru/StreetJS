// Runnable example for @streetjs/plugin-africastalking.
// Uses an injected mock `fetch` so it runs offline (no real API calls / no keys).
import {
  createAfricaTalkingPlugin,
  buildSmsRequest,
  buildAirtimeRequest,
  createUssdRouter,
  con,
  end,
} from '../dist/index.js';

// 1. Build the plugin (sandbox). A mock fetch keeps this example offline.
const at = createAfricaTalkingPlugin({
  apiKey: 'sandbox-key',
  username: 'sandbox',
  sandbox: true,
  fetch: async () =>
    new Response(JSON.stringify({ SMSMessageData: { Message: 'Sent to 1/1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
});

// 2. Inspect a pure request (offline, no network) — note the sandbox host.
console.log('SMS request URL:', buildSmsRequest({ apiKey: 'x', username: 'sandbox', sandbox: true }, {
  to: '+254700000000', message: 'Welcome to StreetJS',
}).url);

console.log('Airtime amount encoding:',
  JSON.parse(new URLSearchParams(
    buildAirtimeRequest({ apiKey: 'x', username: 'sandbox', sandbox: true }, {
      phoneNumber: '+254700000000', amount: 100, currencyCode: 'KES',
    }).body).get('recipients')));

// 3. Send an SMS (executes against the mock fetch).
const res = await at.sms.send({ to: '+254700000000', message: 'Welcome to StreetJS' });
console.log('SMS response:', res.SMSMessageData?.Message);

// 4. USSD router (pure, offline).
const ussd = createUssdRouter()
  .menu('Welcome\n1. Balance\n2. Buy airtime')
  .input('1', () => end('Your balance is KES 500'))
  .input('2', (_req, segs) => (segs.length === 1 ? con('Enter amount:') : end(`Buying KES ${segs[1]} airtime`)))
  .end('Invalid choice.');

console.log('USSD (no input):', ussd.handle({ sessionId: 's', serviceCode: '*123#', phoneNumber: '+254700000000', text: '' }));
console.log('USSD (choice 1):', ussd.handle({ sessionId: 's', serviceCode: '*123#', phoneNumber: '+254700000000', text: '1' }));
console.log('USSD (2 then 50):', ussd.handle({ sessionId: 's', serviceCode: '*123#', phoneNumber: '+254700000000', text: '2*50' }));
