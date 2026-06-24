// End-to-end smoke test for the Multi-tenant CRM reference app.
//   node examples/reference-apps/crm/smoke-test.mjs
// Boots the real server, drives real HTTP requests, asserts multi-tenant
// isolation + RBAC + pipeline behavior, exits 0.

import assert from 'node:assert/strict';
import http from 'node:http';
import { createCrm } from './server.mjs';

const app = await createCrm();
const port = await app.listen(0);
const base = `http://127.0.0.1:${port}`;

function req(method, path, { org, user, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json' };
    if (org) headers['x-org-id'] = org;
    if (user) headers['x-user-id'] = user;
    const r = http.request(base + path, { method, headers }, (res) => {
      let b = ''; res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

let failures = 0;
function check(name, fn) { try { fn(); console.log('  ok  ' + name); } catch (e) { failures++; console.log('  FAIL ' + name + ': ' + e.message); } }

// 0) Health.
const ready = await req('GET', '/health/ready');
check('health/ready returns 200', () => assert.equal(ready.status, 200));

// 1) Build a pipeline in org "acme".
const co = await req('POST', '/companies', { org: 'acme', body: { name: 'Acme Inc' } });
check('create company (201)', () => assert.equal(co.status, 201));
const ct = await req('POST', '/contacts', { org: 'acme', body: { name: 'Ada Lovelace', email: 'ada@acme.test', companyId: co.body.id } });
check('create contact (201)', () => assert.equal(ct.status, 201));
const deal = await req('POST', '/deals', { org: 'acme', body: { title: 'Enterprise plan', contactId: ct.body.id, amountCents: 500000 } });
check('create deal starts at stage lead', () => assert.equal(deal.body.stage, 'lead'));

// 2) A different tenant with its own deal.
const otherDeal = await req('POST', '/deals', { org: 'globex', body: { title: 'Globex pilot' } });
check('other tenant deal created', () => assert.equal(otherDeal.status, 201));

// 3) TENANT ISOLATION — each org sees ONLY its own data.
const acmeDeals = await req('GET', '/deals', { org: 'acme' });
const globexDeals = await req('GET', '/deals', { org: 'globex' });
check('acme sees exactly its own deal', () => {
  assert.equal(acmeDeals.body.deals.length, 1);
  assert.equal(acmeDeals.body.deals[0].title, 'Enterprise plan');
});
check('globex sees exactly its own deal', () => {
  assert.equal(globexDeals.body.deals.length, 1);
  assert.equal(globexDeals.body.deals[0].title, 'Globex pilot');
});
const crossMove = await req('POST', `/deals/${otherDeal.body.id}/move`, { org: 'acme', body: { stage: 'won' } });
check('cross-tenant deal move is rejected (404)', () => assert.equal(crossMove.status, 404));

// 4) Pipeline transitions + activity timeline.
const moved = await req('POST', `/deals/${deal.body.id}/move`, { org: 'acme', body: { stage: 'qualified' } });
check('deal moves to qualified', () => assert.equal(moved.body.stage, 'qualified'));
const pipe = await req('GET', '/pipeline', { org: 'acme' });
check('pipeline reflects the move', () => {
  assert.equal(pipe.body.pipeline.qualified.count, 1);
  assert.equal(pipe.body.pipeline.lead.count, 0);
  assert.equal(pipe.body.pipeline.qualified.valueCents, 500000);
});
check('activity timeline logged create + stage change', () => {
  const acts = app.store.activities('acme', deal.body.id);
  assert.ok(acts.some((a) => a.type === 'created'));
  assert.ok(acts.some((a) => a.type === 'stage' && a.note.includes('qualified')));
});

// 5) Invalid stage rejected.
const bad = await req('POST', `/deals/${deal.body.id}/move`, { org: 'acme', body: { stage: 'bogus' } });
check('invalid stage rejected (400)', () => assert.equal(bad.status, 400));

// 6) RBAC — a viewer (crm:read) cannot write; an editor (crm:write) can.
const viewer = await app.admin.createUser('system', { email: 'viewer@acme.test', roles: ['crm-viewer'] });
const editor = await app.admin.createUser('system', { email: 'editor@acme.test', roles: ['crm-editor'] });
const denied = await req('POST', '/companies', { org: 'acme', user: viewer.id, body: { name: 'Nope LLC' } });
check('viewer is denied write (403)', () => assert.equal(denied.status, 403));
const allowed = await req('POST', '/companies', { org: 'acme', user: editor.id, body: { name: 'Editor Co' } });
check('editor is allowed write (201)', () => assert.equal(allowed.status, 201));
const viewerRead = await req('GET', '/deals', { org: 'acme', user: viewer.id });
check('viewer is allowed read (200)', () => assert.equal(viewerRead.status, 200));

// 7) Unknown route.
const nf = await req('GET', '/nope', { org: 'acme' });
check('unknown route returns 404', () => assert.equal(nf.status, 404));

await app.close();
console.log(failures === 0 ? '\n✅ crm reference app: all checks passed' : `\n❌ ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
