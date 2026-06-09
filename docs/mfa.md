---
layout: default
title: "Multi-Factor Authentication (TOTP)"
nav_exclude: true
---

# Multi-Factor Authentication (TOTP)

`streetjs` ships standards-based TOTP MFA (RFC 6238, built on RFC 4226
HOTP) with single-use recovery codes, an enrollment service, a step-up guard,
and middleware. Pure `node:crypto` — no third-party dependencies. The TOTP/HOTP
implementation is validated against the published RFC test vectors
(`tests/mfa.test.ts`).

## Primitives

```ts
import { totp, verifyTotp, base32Encode, base32Decode } from 'streetjs';
const secret = base32Decode('JBSWY3DPEHPK3PXP');
const code = totp(secret);                 // 6-digit, 30s period, SHA1 (app default)
verifyTotp(secret, code, { window: 1 });   // ±1 period skew, constant-time compare
```

## Enrollment & verification (`MfaService`)

```ts
import { MfaService, MFA_MIGRATION_SQL } from 'streetjs';
// run MFA_MIGRATION_SQL once (creates street_mfa)
const mfa = new MfaService(pool, { issuer: 'Acme' });

const { secret, otpauthUrl, recoveryCodes } = await mfa.beginEnrollment(userId, 'alice@acme.com');
// show otpauthUrl as a QR code; show recoveryCodes once
await mfa.confirmEnrollment(userId, userSuppliedCode); // enables MFA on success
await mfa.verify(userId, code);                        // ongoing verification
await mfa.useRecoveryCode(userId, recoveryCode);       // single-use
await mfa.disable(userId);
```

Secrets are stored as base32; recovery codes are stored only as SHA-256 hashes
and removed on use.

## Step-up middleware (`mfaGuard` + `verifyMfaStepUp`)

```ts
import { mfaGuard, verifyMfaStepUp } from 'streetjs';

// Protect routes: MFA-enabled users must have an MFA-verified session.
app.use(mfaGuard(mfa)); // 403 { error: 'mfa_required' } until verified

// In your MFA-challenge route, after the user submits a code:
const result = await verifyMfaStepUp(mfa, userId, code, ctx); // marks ctx.state.mfaVerified
if (result.ok) { /* issue MFA-elevated session */ }
```

Users without MFA enabled and unauthenticated requests pass through unchanged
(pair with an auth guard upstream).

## Verification

```bash
npx tsc -p packages/core
node --test packages/core/dist/src/tests/mfa.test.js   # 18 tests, 0 fail
```

Covered: RFC 4226 HOTP (10 counters), RFC 6238 TOTP (6 time vectors), base32
round-trip + RFC 4648 vector, skew tolerance, enrollment lifecycle, single-use
recovery codes, and the step-up guard/verify paths.

## Limitations

- TOTP and WebAuthn (passkeys, shipped separately) are the supported factors;
  SMS/email OTP are intentionally not provided (phishing/SIM-swap risk).
