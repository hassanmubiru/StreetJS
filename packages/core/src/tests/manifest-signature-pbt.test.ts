// tests/manifest-signature-pbt.test.ts
// Property-based test for plugin manifest signature verification soundness
// (Req 4.2 — the registry validates an Ed25519 signature before storing;
//  Req 5.7 — installation enforces signature verification and rejects on
//  failure). Kept in its own file so the universal soundness property is
//  exercised across many generated manifests + Ed25519 keypairs without
//  clobbering the example/edge-case unit tests in plugin-host.test.ts.
//
// Soundness has two halves:
//   - COMPLETENESS: a manifest signed with a private key verifies `true`
//     against the matching public key.
//   - INTEGRITY/AUTHENTICITY (the security-critical half): ANY tamper —
//     mutating a signed field, swapping in a foreign signature, verifying
//     against a foreign public key, or altering the recorded checksum — makes
//     verifyManifest return `false`.
//
// The code under test is signManifest / verifyManifest / manifestChecksum in
// platform/plugins/host.ts, built only on node:crypto (Ed25519).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fc from 'fast-check';

import {
  signManifest,
  verifyManifest,
  manifestChecksum,
  type PluginManifest,
  type PluginPermission,
} from '../platform/plugins/host.js';

const NUM_RUNS = 100;

const ALL_PERMS: readonly PluginPermission[] = [
  'middleware', 'events', 'net', 'fs', 'db', 'secrets',
];

// ── Generators ────────────────────────────────────────────────────────────────
//
// A PluginManifest generator covering every field that feeds the canonical
// signable body (name, version, capabilities, permissions, dependencies). The
// checksum/signature fields are intentionally left unset — they are produced by
// signManifest under test.
const versionArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 0, max: 50 }),
    fc.integer({ min: 0, max: 50 }),
    fc.integer({ min: 0, max: 50 }),
  )
  .map(([a, b, c]) => `${a}.${b}.${c}`);

const capabilitiesArb: fc.Arbitrary<string[]> = fc.array(
  fc.string({ minLength: 1, maxLength: 12 }),
  { maxLength: 6 },
);

const permissionsArb: fc.Arbitrary<PluginPermission[]> = fc.uniqueArray(
  fc.constantFrom(...ALL_PERMS),
  { maxLength: ALL_PERMS.length },
);

const dependenciesArb: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 10 }),
  versionArb.map((v) => `^${v}`),
  { maxKeys: 4 },
);

const manifestArb: fc.Arbitrary<PluginManifest> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 20 }),
  version: versionArb,
  capabilities: capabilitiesArb,
  permissions: permissionsArb,
  dependencies: dependenciesArb,
});

/** Fresh Ed25519 keypair (the keypair half of the generator, drawn per run). */
function ed25519(): ReturnType<typeof generateKeyPairSync<'ed25519'>> {
  return generateKeyPairSync('ed25519');
}

// ── Tamper mutators ───────────────────────────────────────────────────────────
//
// Each mutator takes a correctly signed manifest and returns a tampered copy
// that MUST fail verification against the matching public key. Field mutations
// are constructed so the canonical body provably differs (so manifestChecksum
// no longer matches the recorded checksum); the others corrupt the signature or
// checksum directly.
type FieldMutationKind =
  | 'name'
  | 'version'
  | 'add-capability'
  | 'toggle-permission'
  | 'add-dependency';

const fieldMutationArb: fc.Arbitrary<FieldMutationKind> = fc.constantFrom(
  'name', 'version', 'add-capability', 'toggle-permission', 'add-dependency',
);

/** Apply a field mutation guaranteed to change the canonical signable body. */
function mutateField(m: PluginManifest, kind: FieldMutationKind): PluginManifest {
  switch (kind) {
    case 'name':
      return { ...m, name: `${m.name}_tampered` };
    case 'version': {
      const [maj = 0, min = 0, pat = 0] = m.version.split('.').map((x) => Number.parseInt(x, 10) || 0);
      return { ...m, version: `${maj + 1}.${min}.${pat}` };
    }
    case 'add-capability':
      return { ...m, capabilities: [...(m.capabilities ?? []), '__tampered_cap__'] };
    case 'toggle-permission': {
      const perms = new Set(m.permissions ?? []);
      // Toggle a permission that is guaranteed to change the set.
      const present = [...perms];
      if (present.length < ALL_PERMS.length) {
        const toAdd = ALL_PERMS.find((p) => !perms.has(p))!;
        perms.add(toAdd);
      } else {
        perms.delete(present[0]!);
      }
      return { ...m, permissions: [...perms] };
    }
    case 'add-dependency':
      return { ...m, dependencies: { ...(m.dependencies ?? {}), __tampered_dep__: '^1.0.0' } };
  }
}

// Feature: platform-leadership-gaps, Property 8: Signature verification is sound
// Validates: Requirements 4.2, 5.7
describe('Property 8: signature verification is sound', () => {
  it('a correctly signed manifest verifies true against the matching public key (completeness)', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        const { publicKey, privateKey } = ed25519();
        const signed = signManifest(manifest, privateKey);

        // The signing step records a checksum over the canonical body and a
        // signature over that checksum.
        assert.equal(signed.checksum, manifestChecksum(manifest));
        assert.ok(typeof signed.signature === 'string' && signed.signature.length > 0);

        // It verifies true with the matching public key.
        assert.equal(verifyManifest(signed, publicKey), true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('mutating ANY signed field makes verification fail (integrity)', () => {
    fc.assert(
      fc.property(manifestArb, fieldMutationArb, (manifest, kind) => {
        const { publicKey, privateKey } = ed25519();
        const signed = signManifest(manifest, privateKey);
        const tampered = mutateField(signed, kind);

        // The mutation provably changed the canonical body, so the recorded
        // checksum no longer matches — guarding against a no-op mutation.
        assert.notEqual(manifestChecksum(tampered), tampered.checksum);
        assert.equal(verifyManifest(tampered, publicKey), false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('swapping in a foreign signature makes verification fail (authenticity)', () => {
    fc.assert(
      fc.property(manifestArb, manifestArb, (manifest, other) => {
        const { publicKey, privateKey } = ed25519();
        const signed = signManifest(manifest, privateKey);

        // A signature produced over a DIFFERENT canonical body (signed with the
        // same key). Only meaningful when the two checksums differ; otherwise
        // the manifests are signature-equivalent and there is nothing to swap.
        const foreign = signManifest(other, privateKey);
        fc.pre(foreign.checksum !== signed.checksum);

        const tampered: PluginManifest = { ...signed, signature: foreign.signature };
        // Body (and therefore checksum) is untouched, so integrity passes; the
        // signature no longer matches the checksum, so authenticity fails.
        assert.equal(manifestChecksum(tampered), tampered.checksum);
        assert.equal(verifyManifest(tampered, publicKey), false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('verifying against a foreign public key makes verification fail (authenticity)', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        const { privateKey } = ed25519();
        const { publicKey: foreignPublicKey } = ed25519();
        const signed = signManifest(manifest, privateKey);

        // A correct signature, but the wrong public key.
        assert.equal(verifyManifest(signed, foreignPublicKey), false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('altering the recorded checksum makes verification fail (integrity)', () => {
    fc.assert(
      fc.property(manifestArb, (manifest) => {
        const { publicKey, privateKey } = ed25519();
        const signed = signManifest(manifest, privateKey);

        // Flip the first hex nibble of the recorded checksum so it no longer
        // matches the canonical body.
        const original = signed.checksum!;
        const flipped = (original[0] === '0' ? '1' : '0') + original.slice(1);
        const tampered: PluginManifest = { ...signed, checksum: flipped };

        assert.notEqual(tampered.checksum, manifestChecksum(tampered));
        assert.equal(verifyManifest(tampered, publicKey), false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
