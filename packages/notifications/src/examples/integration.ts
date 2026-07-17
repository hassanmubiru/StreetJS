/**
 * @streetjs/notifications — runnable integration example.
 *
 * Wires two channels (a recorded "email" + a function-backed "sms"), a template
 * store, and per-recipient preferences, then dispatches a templated notification
 * to multiple recipients — showing rendering, preference gating, and per-delivery
 * results. No network needed.
 *
 * Run with: `npm run example -w packages/notifications`
 */

import {
  Notifier,
  MemoryChannel,
  FunctionChannel,
  InMemoryTemplateStore,
  InMemoryPreferenceStore,
} from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

const email = new MemoryChannel('email');
const smsLog: string[] = [];
const sms = new FunctionChannel('sms', async (n) => {
  smsLog.push(`${n.address}: ${n.body}`);
  return { id: `sms-${smsLog.length}` };
});

const templates = new InMemoryTemplateStore({
  'order.shipped': {
    subject: 'Your order {{orderId}} shipped',
    body: 'Hi {{recipient.id}}, order {{orderId}} is on its way. Track: {{trackingUrl}}',
  },
});

// u2 has opted out of marketing email but not transactional.
const prefs = new InMemoryPreferenceStore();
prefs.disableCategory('u2', 'email', 'marketing');

const notifier = new Notifier({ channels: [email, sms], templates, preferences: prefs });

// 1. Templated transactional notification to two recipients over both channels.
const results = await notifier.notify({
  to: [
    { id: 'u1', addresses: { email: 'ada@x.dev', sms: '+15550001' } },
    { id: 'u2', addresses: { email: 'bob@x.dev', sms: '+15550002' } },
  ],
  template: 'order.shipped',
  category: 'transactional',
  data: { orderId: 'A-1007', trackingUrl: 'https://track/A-1007' },
});
console.log('deliveries:', results.map((r) => `${r.recipientId}/${r.channel}=${r.status}`).join(', '));
assert(results.length === 4, 'two recipients × two channels');
assert(results.every((r) => r.status === 'sent'), 'transactional bypasses no prefs');
assert(email.sent[0]!.subject === 'Your order A-1007 shipped', 'subject rendered');
console.log('email[0]:', email.sent[0]!.subject, '/', email.sent[0]!.body);
console.log('sms log:', smsLog);

// 2. A marketing email to u2 is skipped by preference; u1 still gets it.
const promo = await notifier.notify({
  to: [{ id: 'u1' }, { id: 'u2' }],
  channels: ['email'],
  category: 'marketing',
  subject: 'Deals for {{recipient.id}}',
  body: 'Save big!',
});
const u2 = promo.find((r) => r.recipientId === 'u2')!;
const u1 = promo.find((r) => r.recipientId === 'u1')!;
assert(u2.status === 'skipped', 'u2 opted out of marketing email');
assert(u1.status === 'sent', 'u1 still receives marketing');
console.log('marketing:', `u1=${u1.status}`, `u2=${u2.status}`);

console.log('\nAll @streetjs/notifications example assertions passed.');
