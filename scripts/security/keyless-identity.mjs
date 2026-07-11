// scripts/security/keyless-identity.mjs
// Keyless-signing identity policy (RFC 0005). The security-critical part of
// keyless verification: the signer's OIDC identity (Fulcio cert) MUST bind to the
// exact StreetJS publish workflow, or an attacker who can run ANY GitHub Actions
// workflow could obtain a valid Fulcio cert and forge a signature.
//
// Pure + dependency-free so it is unit-testable without a live Sigstore stack.
// Consumed by verify-keyless.mjs to build cosign's --certificate-identity /
// --certificate-oidc-issuer pins AND as an in-process defense-in-depth check.

/** The single accepted signer identity for official StreetJS plugin manifests. */
export const PINNED_IDENTITY = Object.freeze({
  // GitHub Actions OIDC issuer — must match exactly.
  issuer: 'https://token.actions.githubusercontent.com',
  // The publish workflow, run from a plugins release tag. Anchored regex.
  identityRegexp:
    '^https://github\\.com/hassanmubiru/StreetJS/\\.github/workflows/publish-plugins\\.yml@refs/tags/plugins-v.*$',
});

/**
 * Decide whether an observed keyless signer identity is acceptable.
 * @param {{issuer?: string, identity?: string}} observed  from the Fulcio cert
 * @param {{issuer: string, identityRegexp: string}} [policy]
 * @returns {boolean}
 */
export function matchesIdentity(observed, policy = PINNED_IDENTITY) {
  if (!observed || typeof observed.issuer !== 'string' || typeof observed.identity !== 'string') {
    return false;
  }
  if (observed.issuer !== policy.issuer) return false; // exact issuer match
  const re = new RegExp(policy.identityRegexp);
  return re.test(observed.identity);
}

/**
 * Build the cosign `verify-blob` arguments that pin the accepted identity.
 * @param {string} blobPath  the signed file (e.g. manifest.json)
 * @param {string} bundlePath  the Sigstore bundle
 * @param {{issuer: string, identityRegexp: string}} [policy]
 * @returns {string[]}
 */
export function cosignVerifyArgs(blobPath, bundlePath, policy = PINNED_IDENTITY) {
  return [
    'verify-blob',
    '--bundle', bundlePath,
    '--certificate-oidc-issuer', policy.issuer,
    '--certificate-identity-regexp', policy.identityRegexp,
    blobPath,
  ];
}
