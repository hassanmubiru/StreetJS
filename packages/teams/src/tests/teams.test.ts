// src/tests/teams.test.ts
// CI-safe: injected fetch for Graph + incoming webhook; a local HMAC for
// outgoing-webhook verification. No live Teams / Microsoft Graph.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  TeamsClient,
  sendIncomingWebhook,
  verifyTeamsOutgoingWebhook,
  computeTeamsSignature,
} from '../index.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function makeFetch(
  responses: Array<{ ok?: boolean; status?: number; body?: string }>,
): { fetch: (u: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>; calls: Captured[] } {
  const calls: Captured[] = [];
  let i = 0;
  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    const c: Captured = { url, method: init.method, headers: init.headers };
    if (init.body !== undefined) c.body = init.body;
    calls.push(c);
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const status = r.status ?? 200;
    const ok = r.ok ?? (status >= 200 && status < 300);
    return { ok, status, text: async () => r.body ?? '' };
  };
  return { fetch, calls };
}

test('TeamsClient requires an accessToken', () => {
  assert.throws(() => new TeamsClient({ accessToken: '' }), /accessToken is required/);
});

test('getTeam / listChannels GET against Graph with bearer auth', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ id: 't1', displayName: 'Eng' }) },
    { body: JSON.stringify({ value: [{ id: 'c1', displayName: 'General' }] }) },
  ]);
  const teams = new TeamsClient({ accessToken: 'tok', fetch });

  const team = await teams.getTeam('t1');
  assert.equal(team.id, 't1');
  assert.equal(calls[0].url, 'https://graph.microsoft.com/v1.0/teams/t1');
  assert.equal(calls[0].headers['authorization'], 'Bearer tok');

  const channels = await teams.listChannels('t1');
  assert.deepEqual(channels, [{ id: 'c1', displayName: 'General' }]);
  assert.equal(calls[1].url, 'https://graph.microsoft.com/v1.0/teams/t1/channels');
});

test('listChannels returns [] when value is absent', async () => {
  const { fetch } = makeFetch([{ body: '{}' }]);
  const teams = new TeamsClient({ accessToken: 'tok', fetch });
  assert.deepEqual(await teams.listChannels('t1'), []);
});

test('sendChannelMessage / sendChatMessage POST the message body payload', async () => {
  const { fetch, calls } = makeFetch([
    { status: 201, body: JSON.stringify({ id: 'm1' }) },
    { status: 201, body: JSON.stringify({ id: 'm2' }) },
  ]);
  const teams = new TeamsClient({ accessToken: 'tok', fetch });

  await teams.sendChannelMessage('t1', 'c1', '<b>Deploy complete</b>');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://graph.microsoft.com/v1.0/teams/t1/channels/c1/messages');
  assert.deepEqual(JSON.parse(calls[0].body!), { body: { contentType: 'html', content: '<b>Deploy complete</b>' } });

  await teams.sendChatMessage('chat1', 'hi there', 'text');
  assert.equal(calls[1].url, 'https://graph.microsoft.com/v1.0/chats/chat1/messages');
  assert.deepEqual(JSON.parse(calls[1].body!), { body: { contentType: 'text', content: 'hi there' } });
});

test('a non-2xx Graph response throws with the status', async () => {
  const { fetch } = makeFetch([{ status: 403, ok: false, body: '{"error":{"code":"Forbidden"}}' }]);
  const teams = new TeamsClient({ accessToken: 'tok', fetch });
  await assert.rejects(() => teams.sendChatMessage('chat1', 'x'), /403/);
});

test('sendIncomingWebhook POSTs the card and validates inputs', async () => {
  const { fetch, calls } = makeFetch([{ status: 200, body: '1' }]);
  await sendIncomingWebhook('https://outlook.office.com/webhook/abc', { text: 'hello' }, { fetch });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://outlook.office.com/webhook/abc');
  assert.deepEqual(JSON.parse(calls[0].body!), { text: 'hello' });

  await assert.rejects(() => sendIncomingWebhook('', { text: 'x' }, { fetch }), /webhookUrl is required/);

  const { fetch: badFetch } = makeFetch([{ status: 400, ok: false, body: 'Bad payload' }]);
  await assert.rejects(
    () => sendIncomingWebhook('https://outlook.office.com/webhook/abc', {}, { fetch: badFetch }),
    /incoming webhook failed: 400/,
  );
});

test('sendIncomingWebhook falls back to the global fetch and errors when none exists', async () => {
  const original = (globalThis as { fetch?: unknown }).fetch;
  try {
    // Install a fake global fetch; call without options.fetch to hit the fallback.
    const calls: string[] = [];
    (globalThis as { fetch?: unknown }).fetch = async (url: string) => {
      calls.push(url);
      return { ok: true, status: 200, text: async () => '1' };
    };
    await sendIncomingWebhook('https://outlook.office.com/webhook/g', { text: 'via global' });
    assert.deepEqual(calls, ['https://outlook.office.com/webhook/g']);

    // Remove the global fetch → the "no fetch available" guard fires.
    delete (globalThis as { fetch?: unknown }).fetch;
    await assert.rejects(
      () => sendIncomingWebhook('https://outlook.office.com/webhook/g', { text: 'x' }),
      /No fetch available/,
    );
  } finally {
    (globalThis as { fetch?: unknown }).fetch = original;
  }
});

test('sendIncomingWebhook tolerates a failing response.text() on the error path', async () => {
  const fetch = async () => ({
    ok: false,
    status: 502,
    text: async () => {
      throw new Error('stream closed');
    },
  });
  await assert.rejects(
    () => sendIncomingWebhook('https://outlook.office.com/webhook/x', {}, { fetch }),
    /incoming webhook failed: 502/,
  );
});

test('computeTeamsSignature matches a manual base64 HMAC', () => {
  const secret = Buffer.from('super-secret-key').toString('base64');
  const body = '{"type":"message","text":"hi"}';
  const key = Buffer.from(secret, 'base64');
  const expected = 'HMAC ' + createHmac('sha256', key).update(Buffer.from(body, 'utf8')).digest('base64');
  assert.equal(computeTeamsSignature(secret, body), expected);
});

test('verifyTeamsOutgoingWebhook accepts a valid HMAC and rejects bad ones', () => {
  const secret = Buffer.from('super-secret-key').toString('base64');
  const body = '{"type":"message","text":"hi"}';
  const authorization = computeTeamsSignature(secret, body);

  assert.equal(verifyTeamsOutgoingWebhook({ secret, body, authorization }), true);
  // Tampered body.
  assert.equal(verifyTeamsOutgoingWebhook({ secret, body: body + ' ', authorization }), false);
  // Wrong secret.
  const otherSecret = Buffer.from('different-key').toString('base64');
  assert.equal(verifyTeamsOutgoingWebhook({ secret: otherSecret, body, authorization }), false);
  // Missing / malformed header.
  assert.equal(verifyTeamsOutgoingWebhook({ secret, body, authorization: '' }), false);
  assert.equal(verifyTeamsOutgoingWebhook({ secret, body, authorization: 'Bearer xyz' }), false);
});
