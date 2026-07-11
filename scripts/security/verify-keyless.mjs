#!/usr/bin/env node
// scripts/security/verify-keyless.mjs
// Verify a keyless (Sigstore) signature over a plugin manifest, pinning the
// signer identity to the official publish workflow (RFC 0005).
//
// Delegates the cryptographic verification (signature + Fulcio cert chain + Rekor
// inclusion) to the cosign CLI — the same tool used for release-asset signing —
// with the identity pins from keyless-identity.mjs. cosign lives in CI (installed
// by the workflow); this is a CI/tooling script, so it stays out of the
// dependency-free core.
//
// Exit semantics (matches the repo's honest-BLOCKED convention):
//   • cosign not installed            → BLOCKED, exit 0 (infra, not a defect)
//   • signature/identity verify fails → exit 1
//   • verified                        → exit 0
//
// Usage:
//   node scripts/security/verify-keyless.mjs <blob> <bundle>
//   e.g. node scripts/security/verify-keyless.mjs packages/plugin-auth0/manifest.json \
//                                                  packages/plugin-auth0/manifest.cosign.bundle

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cosignVerifyArgs, PINNED_IDENTITY } from './keyless-identity.mjs';

function hasCosign() {
  try { execFileSync('cosign', ['version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function main() {
  const [blob, bundle] = process.argv.slice(2);
  if (!blob || !bundle) {
    console.error('usage: verify-keyless.mjs <blob> <bundle>');
    process.exit(2);
  }
  if (!existsSync(blob)) { console.error(`[keyless] blob not found: ${blob}`); process.exit(2); }
  if (!existsSync(bundle)) { console.error(`[keyless] bundle not found: ${bundle}`); process.exit(2); }

  if (!hasCosign()) {
    console.log('[keyless] BLOCKED: cosign not installed — cannot verify keyless signature here (exit 0).');
    process.exit(0);
  }

  const args = cosignVerifyArgs(blob, bundle);
  console.log(`[keyless] verifying ${blob}`);
  console.log(`[keyless]   issuer  = ${PINNED_IDENTITY.issuer}`);
  console.log(`[keyless]   identity~ ${PINNED_IDENTITY.identityRegexp}`);
  try {
    execFileSync('cosign', args, { stdio: 'inherit' });
    console.log('[keyless] ✔ signature + pinned identity verified');
    process.exit(0);
  } catch {
    console.error('[keyless] ✖ verification FAILED (bad signature or unpinned identity)');
    process.exit(1);
  }
}

main();
