/**
 * @streetjs/integrations — runnable example.
 *
 * Shows the base connector (with an injected fetch, so no network) and inbound
 * webhook signature verification — the two things every vendor connector reuses.
 *
 * Run with: `npm run example -w packages/integrations`
 */

import { createHmac } from 'node:crypto';
import { HttpConnector, verifyHmacSignature, type FetchLike, type HttpResponseLike } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}
const ok = (body: string): HttpResponseLike => ({ ok: true, status: 200, text: async () => body });

// A tiny vendor connector built on the base — this is the whole pattern.
class DemoApi extends HttpConnector {
  listWidgets() { return this.request<{ id: string }[]>('/widgets', { query: { limit: 10 } }); }
  createWidget(name: string) { return this.request<{ id: string }>('/widgets', { method: 'POST', body: { name } }); }
}

const fetch: FetchLike = async (url, init) => {
  console.log(`  → ${init.method} ${url}`);
  return init.method === 'POST' ? ok('{"id":"w-1"}') : ok('[{"id":"w-0"}]');
};

const api = new DemoApi({ baseUrl: 'https://api.demo.dev', auth: { type: 'bearer', token: 'demo' }, fetch });
const list = await api.listWidgets();
const created = await api.createWidget('hello');
console.log('list:', list, '· created:', created);
assert(list[0]!.id === 'w-0' && created.id === 'w-1', 'connector round-trips JSON');

// Inbound webhook verification (GitHub-style sha256= prefix).
const secret = 'whsec';
const payload = '{"event":"push"}';
const signature = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
assert(verifyHmacSignature({ algorithm: 'sha256', secret, payload, signature, prefix: 'sha256=' }), 'valid signature');
assert(!verifyHmacSignature({ algorithm: 'sha256', secret: 'nope', payload, signature, prefix: 'sha256=' }), 'bad secret rejected');
console.log('webhook signature verified');

console.log('\nAll @streetjs/integrations example assertions passed.');
