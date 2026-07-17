import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Notifier,
  NotificationError,
  MemoryChannel,
  FunctionChannel,
  renderTemplate,
  InMemoryTemplateStore,
  InMemoryPreferenceStore,
  AllowAllPreferences,
  type DeliveryResult,
  type NotificationChannel,
  type RenderedNotification,
} from '../index.js';

// ── renderTemplate (pure) ────────────────────────────────────────────────────────

test('renderTemplate interpolates variables, dotted paths, and objects', () => {
  assert.equal(renderTemplate('Hi {{ name }}!', { name: 'Ada' }), 'Hi Ada!');
  assert.equal(renderTemplate('{{a.b.c}}', { a: { b: { c: 'deep' } } }), 'deep');
  assert.equal(renderTemplate('n={{count}}', { count: 3 }), 'n=3');
  assert.equal(renderTemplate('{{obj}}', { obj: { x: 1 } }), '{"x":1}');
});

test('renderTemplate renders missing/null values as empty strings', () => {
  assert.equal(renderTemplate('[{{missing}}]', {}), '[]');
  assert.equal(renderTemplate('[{{n}}]', { n: null }), '[]');
  assert.equal(renderTemplate('[{{a.b}}]', { a: {} }), '[]');
  assert.equal(renderTemplate('no vars'), 'no vars');
});

// ── InMemoryTemplateStore ────────────────────────────────────────────────────────

test('InMemoryTemplateStore stores and retrieves templates', () => {
  const store = new InMemoryTemplateStore({ a: { body: 'A' } });
  store.set('b', { subject: 'S', body: 'B' });
  assert.equal(store.get('a')?.body, 'A');
  assert.equal(store.get('b')?.subject, 'S');
  assert.equal(store.get('missing'), undefined);
});

// ── InMemoryPreferenceStore ────────────────────────────────────────────────────

test('preferences: enabled by default, opt-out by channel and category, mandatory wins', async () => {
  const prefs = new InMemoryPreferenceStore();
  assert.equal(await prefs.isEnabled('u1', 'email'), true, 'default enabled');

  prefs.disableChannel('u1', 'email');
  assert.equal(await prefs.isEnabled('u1', 'email'), false, 'channel opt-out');
  prefs.enableChannel('u1', 'email');
  assert.equal(await prefs.isEnabled('u1', 'email'), true, 're-enabled');

  prefs.disableCategory('u1', 'email', 'marketing');
  assert.equal(await prefs.isEnabled('u1', 'email', 'marketing'), false, 'category opt-out');
  assert.equal(await prefs.isEnabled('u1', 'email', 'security'), true, 'other category unaffected');

  prefs.markMandatory('security');
  prefs.disableChannel('u1', 'sms');
  assert.equal(await prefs.isEnabled('u1', 'sms', 'security'), true, 'mandatory overrides opt-out');
});

test('AllowAllPreferences always permits', async () => {
  assert.equal(await new AllowAllPreferences().isEnabled(), true);
});

// ── Channels ──────────────────────────────────────────────────────────────────

test('MemoryChannel records deliveries and returns ids; FunctionChannel wraps a fn', async () => {
  const mem = new MemoryChannel('email');
  const r = { channel: 'email', recipient: { id: 'u1' }, body: 'hi', data: {}, metadata: {} } as RenderedNotification;
  const res = await mem.send(r);
  assert.equal(mem.sent.length, 1);
  assert.match(res.id, /^email-0$/);

  const seen: string[] = [];
  const fn = new FunctionChannel('sms', async (rn) => { seen.push(rn.body); return { id: 'x' }; });
  await fn.send(r);
  assert.deepEqual(seen, ['hi']);
});

// ── Notifier ────────────────────────────────────────────────────────────────────

test('Notifier requires at least one channel', () => {
  assert.throws(() => new Notifier({ channels: [] }), NotificationError);
});

test('notify renders a literal subject/body and delivers to default channels', async () => {
  const email = new MemoryChannel('email');
  const sms = new MemoryChannel('sms');
  const notifier = new Notifier({ channels: [email, sms] });
  const results = await notifier.notify({
    to: { id: 'u1', addresses: { email: 'a@b.co', sms: '+1555' } },
    subject: 'Hello {{name}}',
    body: 'Welcome, {{name}}!',
    data: { name: 'Ada' },
  });
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.status === 'sent'));
  assert.equal(email.sent[0]!.subject, 'Hello Ada');
  assert.equal(email.sent[0]!.body, 'Welcome, Ada!');
  assert.equal(email.sent[0]!.address, 'a@b.co');
  assert.equal(sms.sent[0]!.address, '+1555');
});

test('notify renders from a template store and fails fast on an unknown template', async () => {
  const email = new MemoryChannel('email');
  const templates = new InMemoryTemplateStore({ welcome: { subject: 'Hi {{name}}', body: 'Body for {{name}}' } });
  const notifier = new Notifier({ channels: [email], templates });

  const results = await notifier.notify({ to: { id: 'u1' }, template: 'welcome', data: { name: 'Neo' } });
  assert.equal(results[0]!.status, 'sent');
  assert.equal(email.sent[0]!.subject, 'Hi Neo');
  assert.equal(email.sent[0]!.body, 'Body for Neo');

  await assert.rejects(() => notifier.notify({ to: { id: 'u1' }, template: 'nope' }), NotificationError);
});

test('notify honors explicit channels and multiple recipients', async () => {
  const email = new MemoryChannel('email');
  const sms = new MemoryChannel('sms');
  const notifier = new Notifier({ channels: [email, sms] });
  const results = await notifier.notify({
    to: [{ id: 'u1' }, { id: 'u2' }],
    channels: ['email'],
    body: 'hi',
  });
  assert.equal(results.length, 2, 'two recipients × one channel');
  assert.ok(results.every((r) => r.channel === 'email' && r.status === 'sent'));
  assert.equal(sms.sent.length, 0, 'sms not targeted');
});

test('notify skips channels the recipient opted out of', async () => {
  const email = new MemoryChannel('email');
  const prefs = new InMemoryPreferenceStore();
  prefs.disableCategory('u1', 'email', 'marketing');
  const notifier = new Notifier({ channels: [email], preferences: prefs });

  const results = await notifier.notify({ to: { id: 'u1' }, category: 'marketing', body: 'promo' });
  assert.equal(results[0]!.status, 'skipped');
  assert.match(results[0]!.error!, /opt-out/);
  assert.equal(email.sent.length, 0);
});

test('notify reports an unknown requested channel as failed', async () => {
  const email = new MemoryChannel('email');
  const notifier = new Notifier({ channels: [email] });
  const results = await notifier.notify({ to: { id: 'u1' }, channels: ['carrier-pigeon'], body: 'x' });
  assert.equal(results[0]!.status, 'failed');
  assert.match(results[0]!.error!, /unknown channel/);
});

test('a channel failure is captured per-delivery and never aborts the batch', async () => {
  const flaky: NotificationChannel = {
    name: 'push',
    async send() { throw new Error('APNs down'); },
  };
  const email = new MemoryChannel('email');
  const notifier = new Notifier({ channels: [flaky, email] });
  const results = await notifier.notify({ to: { id: 'u1' }, channels: ['push', 'email'], body: 'hi' });
  const push = results.find((r) => r.channel === 'push')!;
  const mail = results.find((r) => r.channel === 'email')!;
  assert.equal(push.status, 'failed');
  assert.match(push.error!, /APNs down/);
  assert.equal(mail.status, 'sent', 'other channel still delivered');
});

test('onResult observes every delivery result; channelNames lists registrations', async () => {
  const observed: DeliveryResult[] = [];
  const notifier = new Notifier({
    channels: [new MemoryChannel('email'), new MemoryChannel('sms')],
    defaultChannels: ['email'],
    onResult: (r) => observed.push(r),
  });
  assert.deepEqual(notifier.channelNames(), ['email', 'sms']);
  await notifier.notify({ to: { id: 'u1' }, body: 'hi' });
  assert.equal(observed.length, 1, 'default channels = [email]');
  assert.equal(observed[0]!.channel, 'email');
});

test('a channel returning no id still yields a sent result without an id', async () => {
  const notifier = new Notifier({ channels: [new FunctionChannel('noop', async () => undefined)] });
  const results = await notifier.notify({ to: { id: 'u1' }, body: 'hi' });
  assert.equal(results[0]!.status, 'sent');
  assert.equal(results[0]!.id, undefined);
});
