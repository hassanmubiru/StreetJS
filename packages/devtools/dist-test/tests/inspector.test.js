// tests/inspector.test.ts
// Unit tests for the gated API Inspector flow (Req 7.4 / 7.5 / 7.7).
// Verifies that the gate is enforced BEFORE any network call, that a successful
// read-only request renders status/headers/body, and that any failure surfaces
// an error indication while retaining the submitted request input.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DevtoolsAuthGate } from '../auth.js';
import { inspect } from '../inspector.js';
const TOKEN = 'token-123';
const gate = DevtoolsAuthGate.fromToken(TOKEN);
/** A fetch stub that records whether it was called and returns a canned reply. */
function stubFetch(reply) {
    const box = { calls: 0 };
    const fetch = async () => {
        box.calls++;
        return {
            status: reply.status,
            headers: {
                forEach(cb) {
                    for (const [k, v] of Object.entries(reply.headers))
                        cb(v, k);
                },
            },
            async text() {
                return reply.body;
            },
        };
    };
    return { fetch, get calls() { return box.calls; } };
}
describe('inspect — success path (Req 7.4)', () => {
    it('renders status, headers, and body for an authorized read-only request', async () => {
        const stub = stubFetch({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });
        const req = { method: 'GET', url: 'https://app.test/users/1' };
        const result = await inspect(gate, TOKEN, req, stub.fetch);
        assert.equal(result.ok, true);
        assert.equal(result.status, 200);
        assert.equal(result.headers?.['content-type'], 'application/json');
        assert.equal(result.body, '{"ok":true}');
        assert.deepEqual(result.request, req);
        assert.equal(stub.calls, 1);
    });
});
describe('inspect — gate enforcement before any network call (Req 7.7)', () => {
    it('rejects a missing token without calling fetch and retains the input (Req 7.5)', async () => {
        const stub = stubFetch({ status: 200, headers: {}, body: '' });
        const req = { method: 'GET', url: 'https://app.test/x', headers: { 'x-test': '1' } };
        const result = await inspect(gate, undefined, req, stub.fetch);
        assert.equal(result.ok, false);
        assert.match(result.error ?? '', /token/i);
        assert.deepEqual(result.request, req); // submitted input retained verbatim
        assert.equal(stub.calls, 0, 'fetch must NOT be called when the token is missing');
    });
    it('rejects a mutating method without calling fetch and retains the input (Req 7.5)', async () => {
        const stub = stubFetch({ status: 200, headers: {}, body: '' });
        const req = { method: 'DELETE', url: 'https://app.test/users/1', body: '{}' };
        const result = await inspect(gate, TOKEN, req, stub.fetch);
        assert.equal(result.ok, false);
        assert.match(result.error ?? '', /read-only/i);
        assert.deepEqual(result.request, req);
        assert.equal(stub.calls, 0, 'fetch must NOT be called for a mutating method');
    });
});
describe('inspect — failure path (Req 7.5)', () => {
    it('surfaces a network error and retains the submitted request input', async () => {
        const failing = async () => {
            throw new Error('connection refused');
        };
        const req = { method: 'GET', url: 'https://down.test/health', headers: { authorization: 'redacted' } };
        const result = await inspect(gate, TOKEN, req, failing);
        assert.equal(result.ok, false);
        assert.match(result.error ?? '', /connection refused/);
        assert.deepEqual(result.request, req);
    });
});
//# sourceMappingURL=inspector.test.js.map