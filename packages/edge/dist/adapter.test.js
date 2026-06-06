// packages/edge/src/adapter.test.ts
// In-process test for the edge adapter: Web Fetch Request → Response via StreetApp.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { streetApp } from '@streetjs/core';
import { handleEdgeRequest } from './adapter.js';
describe('handleEdgeRequest', () => {
    it('routes a GET request through the middleware pipeline and returns JSON', async () => {
        const app = streetApp();
        app.use(async (ctx, next) => {
            if (ctx.path === '/ping') {
                ctx.json({ pong: true, method: ctx.method });
                return;
            }
            await next();
        });
        const res = await handleEdgeRequest(new Request('https://edge.example/ping'), app);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.pong, true);
        assert.equal(body.method, 'GET');
    });
    it('echoes a POST body', async () => {
        const app = streetApp();
        app.use(async (ctx, next) => {
            if (ctx.path === '/echo') {
                ctx.json({ received: ctx.body });
                return;
            }
            await next();
        });
        const res = await handleEdgeRequest(new Request('https://edge.example/echo', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ hello: 'world' }),
        }), app);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.received.hello, 'world');
    });
    it('returns 404 for unmatched routes', async () => {
        const app = streetApp();
        const res = await handleEdgeRequest(new Request('https://edge.example/missing'), app);
        assert.equal(res.status, 404);
    });
});
//# sourceMappingURL=adapter.test.js.map