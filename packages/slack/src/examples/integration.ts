/**
 * @streetjs/slack — runnable example.
 *
 * Posts messages via an injected fetch (no network) and verifies an inbound
 * Slack request signature. In production you pass a real bot token and omit the
 * fetch override.
 *
 * Run with: `npm run example -w packages/slack`
 */

import { createHmac } from 'node:crypto';
import { SlackClient, verifySlackRequest } from '../index.js';
import type { FetchLike, HttpResponseLike } from '@streetjs/integrations';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}
const ok = (body: unknown): HttpResponseLike => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

const fetch: FetchLike = async (url, init) => {
  console.log(`  → POST ${url.split('/api/')[1]} ${init.body}`);
  return ok({ ok: true, ts: '1700000000.000100', channel: 'C123' });
};

const slack = new SlackClient({ token: 'xoxb-demo', fetch });
const res = await slack.postMessage({ channel: '#deploys', text: 'Build 1007 shipped :rocket:' });
assert(res.ok === true, 'message posted');
await slack.addReaction('C123', String(res['ts']), 'white_check_mark');
console.log('posted + reacted');

// Verify an inbound Slack event signature (v0 scheme).
const secret = 'signing-secret';
const ts = Math.floor(Date.now() / 1000);
const body = 'payload=%7B%22type%22%3A%22event_callback%22%7D';
const signature = 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex');
assert(verifySlackRequest({ signingSecret: secret, timestamp: ts, body, signature }), 'valid Slack signature');
assert(!verifySlackRequest({ signingSecret: 'wrong', timestamp: ts, body, signature }), 'bad secret rejected');
console.log('inbound Slack request verified');

console.log('\nAll @streetjs/slack example assertions passed.');
