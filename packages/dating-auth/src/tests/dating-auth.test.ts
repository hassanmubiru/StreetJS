// packages/dating-auth/src/tests/dating-auth.test.ts
// Tests for @streetjs/dating-auth. These verify that the wrapper correctly
// composes the core JwtService / SessionManager / AbuseEngine primitives and
// introduces no auth logic of its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fc from 'fast-check';

import { DatingAuthService, type DatingAuthOptions } from '../index.js';

const JWT_SECRET = 'a'.repeat(40); // ≥ 32 chars, accepted by core JwtService
const SESSION_KEY = randomBytes(32).toString('hex'); // 64-char hex, high entropy

/** A permissive abuse config so the happy path is never throttled. */
function baseConfig(): DatingAuthOptions['abuse']['config'] {
  return {
    loginFailureThreshold: 3,
    loginWindowMs: 60_000,
    lockoutMs: 300_000,
    signupThreshold: 3,
    signupWindowMs: 60_000,
    sprayDistinctAccounts: 5,
    sprayWindowMs: 60_000,
    scoreThreshold: 1000, // effectively disabled for most tests
  };
}

/** Build a service with an injected fixed clock for deterministic windows. */
function makeService(overrides: Partial<DatingAuthOptions> = {}, now = 1_000): DatingAuthService {
  return new DatingAuthService({
    jwtSecret: JWT_SECRET,
    sessionKey: SESSION_KEY,
    abuse: { config: baseConfig(), clock: () => now },
    ...overrides,
  });
}

test('login issues a verifiable token and an openable session on valid credentials', async () => {
  const auth = makeService();
  const result = await auth.login({
    ip: '203.0.113.7',
    accountId: 'user-1',
    credentialsValid: true,
    payload: { email: 'a@example.com', roles: ['member'] },
    session: { email: 'a@example.com' },
  });

  assert.equal(result.ok, true);
  assert.ok(result.token, 'token issued');
  assert.ok(result.session, 'session issued');

  const claims = auth.verifyToken(result.token!);
  assert.ok(claims, 'token verifies');
  assert.equal(claims!.sub, 'user-1');
  assert.equal(claims!.email, 'a@example.com');

  const session = auth.readSession(result.session!);
  assert.ok(session, 'session opens');
  assert.equal(session!.userId, 'user-1');
});

test('login refuses invalid credentials without issuing a token or session', async () => {
  const auth = makeService();
  const result = await auth.login({ ip: '203.0.113.7', accountId: 'user-1', credentialsValid: false });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'INVALID_CREDENTIALS');
  assert.equal(result.token, undefined);
  assert.equal(result.session, undefined);
});

test('repeated failed logins trip the core lockout and refuse further attempts', async () => {
  const now = 5_000;
  const auth = makeService({}, now);

  // 3 failures (threshold) trip the lockout.
  for (let i = 0; i < 3; i++) {
    await auth.login({ ip: '198.51.100.4', accountId: 'victim', credentialsValid: false, ts: now });
  }
  assert.equal(await auth.isLockedOut('victim', now), true);

  // Even a valid attempt is refused while locked out.
  const result = await auth.login({ ip: '198.51.100.4', accountId: 'victim', credentialsValid: true, ts: now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'LOCKED_OUT');
  assert.equal(result.token, undefined);
});

test('signup attempts are throttled once the per-source threshold is reached', async () => {
  const now = 7_000;
  const auth = makeService({}, now);

  assert.equal((await auth.signup('192.0.2.9', now)).allowed, true);
  assert.equal((await auth.signup('192.0.2.9', now)).allowed, true);
  const third = await auth.signup('192.0.2.9', now);
  assert.equal(third.allowed, false);
  assert.equal(third.reason, 'SIGNUP_THROTTLED');
});

test('a high suspicious score blocks login and fires the configured response action', async () => {
  const now = 9_000;
  let triggered = false;
  const auth = new DatingAuthService({
    jwtSecret: JWT_SECRET,
    sessionKey: SESSION_KEY,
    abuse: {
      config: {
        ...baseConfig(),
        scoreThreshold: 1,
        responseAction: () => {
          triggered = true;
        },
      },
      clock: () => now,
      ipReputation: async () => 100, // forces the core-computed score over threshold
    },
  });

  const result = await auth.login({ ip: '203.0.113.50', accountId: 'u', credentialsValid: true, ts: now });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SCORE_EXCEEDED');
  assert.equal(triggered, true); // the core engine invoked the configured action
});

test('static helpers delegate to the core SessionManager and produce distinct values', () => {
  const csrf1 = DatingAuthService.generateCsrf();
  const csrf2 = DatingAuthService.generateCsrf();
  const sid = DatingAuthService.generateSessionId();
  assert.notEqual(csrf1, csrf2);
  assert.ok(csrf1.length > 0 && sid.length > 0);
});

test('property: token + session round-trip through the wrapper for arbitrary account ids', () => {
  const auth = makeService();
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 64 }),
      fc.string({ minLength: 1, maxLength: 64 }),
      (accountId, email) => {
        const token = auth.issueToken({ sub: accountId, email });
        const claims = auth.verifyToken(token);
        assert.ok(claims);
        assert.equal(claims!.sub, accountId);
        assert.equal(claims!.email, email);

        const blob = auth.createSession({ userId: accountId, email });
        const session = auth.readSession(blob);
        assert.ok(session);
        assert.equal(session!.userId, accountId);
        assert.equal(session!.email, email);
      },
    ),
    { numRuns: 200 },
  );
});

test('property: a tampered token never verifies through the wrapper', () => {
  const auth = makeService();
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 32 }), (accountId) => {
      const token = auth.issueToken({ sub: accountId });
      const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
      assert.equal(auth.verifyToken(tampered), null);
    }),
    { numRuns: 200 },
  );
});
