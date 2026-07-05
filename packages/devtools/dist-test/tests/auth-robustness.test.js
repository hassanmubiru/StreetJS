// tests/auth-robustness.test.ts
// Fast-check robustness checks for the devtools authorization gate (Req 7.7).
// These are not a numbered design Property; they harden the security-critical
// enforcement by exercising it across many generated tokens and methods, on top
// of the example-based unit tests in auth.test.ts.
import { describe, it } from 'node:test';
import fc from 'fast-check';
import assert from 'node:assert/strict';
import { DevtoolsAuthGate, SAFE_METHODS, isSafeMethod } from '../auth.js';
const NUM_RUNS = 200;
const TOKEN = 'fixed-correct-token';
const methodArb = fc.oneof(fc.constantFrom(...SAFE_METHODS, 'GET', 'HEAD', 'OPTIONS'), fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE', 'CONNECT', 'TRACE'), fc.string({ minLength: 1, maxLength: 8 }));
describe('gate robustness (Req 7.7)', () => {
    it('fails closed: any token that is not exactly the correct token is UNAUTHENTICATED', () => {
        const gate = DevtoolsAuthGate.fromToken(TOKEN);
        fc.assert(fc.property(fc.oneof(fc.constant(undefined), fc.string({ maxLength: 40 })).filter((t) => t !== TOKEN), methodArb, (badToken, method) => {
            const d = gate.authorize({ token: badToken, method });
            assert.equal(d.allowed, false);
            assert.equal(d.code, 'UNAUTHENTICATED');
        }), { numRuns: NUM_RUNS });
    });
    it('with a valid token, allowed iff the method is read-only (safe)', () => {
        const gate = DevtoolsAuthGate.fromToken(TOKEN);
        fc.assert(fc.property(methodArb, (method) => {
            const d = gate.authorize({ token: TOKEN, method });
            if (isSafeMethod(method)) {
                assert.equal(d.allowed, true);
                assert.equal(d.code, 'ALLOWED');
            }
            else {
                assert.equal(d.allowed, false);
                assert.equal(d.code, 'READ_ONLY');
            }
        }), { numRuns: NUM_RUNS });
    });
    it('a mutating method is never allowed regardless of token', () => {
        const gate = DevtoolsAuthGate.fromToken(TOKEN);
        fc.assert(fc.property(fc.oneof(fc.constant(TOKEN), fc.string({ maxLength: 40 })), fc.constantFrom('POST', 'PUT', 'PATCH', 'DELETE'), (token, method) => {
            assert.equal(gate.authorize({ token, method }).allowed, false);
        }), { numRuns: NUM_RUNS });
    });
});
//# sourceMappingURL=auth-robustness.test.js.map