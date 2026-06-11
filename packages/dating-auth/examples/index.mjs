// Runnable example: dating authentication composed entirely from core
// primitives. Build the package first (`npm run build`), then run:
//
//   node examples/index.mjs
//
// The example uses an injected fixed clock so the abuse windows are
// deterministic and the run is fully offline (no network, no real secrets).

import { randomBytes } from 'node:crypto';
import { DatingAuthService } from '../dist/index.js';

const now = 1_000;
const auth = new DatingAuthService({
  jwtSecret: 'example-jwt-secret-that-is-long-enough',
  sessionKey: randomBytes(32).toString('hex'),
  abuse: {
    config: {
      loginFailureThreshold: 3,
      loginWindowMs: 60_000,
      lockoutMs: 300_000,
      signupThreshold: 3,
      signupWindowMs: 60_000,
      sprayDistinctAccounts: 5,
      sprayWindowMs: 60_000,
      scoreThreshold: 1000,
    },
    clock: () => now,
  },
});

// 1) Successful login — the caller has already verified the password hash.
const ok = await auth.login({
  ip: '203.0.113.10',
  accountId: 'alice',
  credentialsValid: true,
  payload: { email: 'alice@example.com', roles: ['member'] },
});
console.log('login ok:', ok.ok);
console.log('token verifies as:', auth.verifyToken(ok.token).sub);
console.log('session opens as:', auth.readSession(ok.session).userId);

// 2) Invalid credentials are refused with no token issued.
const bad = await auth.login({ ip: '203.0.113.10', accountId: 'alice', credentialsValid: false });
console.log('\ninvalid credentials ok:', bad.ok, '-> reason:', bad.reason);

// 3) Repeated failures trip the core AbuseEngine lockout.
for (let i = 0; i < 3; i++) {
  await auth.login({ ip: '198.51.100.7', accountId: 'victim', credentialsValid: false, ts: now });
}
console.log('\nvictim locked out:', await auth.isLockedOut('victim', now));
const blocked = await auth.login({ ip: '198.51.100.7', accountId: 'victim', credentialsValid: true, ts: now });
console.log('valid attempt while locked out ok:', blocked.ok, '-> reason:', blocked.reason);

// 4) Signup throttling per source.
console.log('\nsignup #1 allowed:', (await auth.signup('192.0.2.5', now)).allowed);
console.log('signup #2 allowed:', (await auth.signup('192.0.2.5', now)).allowed);
console.log('signup #3 allowed:', (await auth.signup('192.0.2.5', now)).allowed);
