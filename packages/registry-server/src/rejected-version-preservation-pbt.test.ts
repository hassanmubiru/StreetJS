// rejected-version-preservation-pbt.test.ts
// Property-based test for the Network Plugin Registry's reject-and-preserve
// guarantee (Req 4.4, 5.7, 5.8). Kept in its own file so the universal property
// is exercised across many generated rejection scenarios without clobbering
// example/edge-case unit tests.
//
// Req 4.4: IF a plugin's integrity validation fails, THEN the registry SHALL
//   reject the plugin, SHALL NOT serve it for installation, SHALL preserve any
//   previously published valid versions, and SHALL return an error indication.
// Req 5.7/5.8: installation enforces signature/manifest validation; a rejected
//   version is never served so it can never be installed, and the set of
//   installable (downloadable + signature-valid) versions is left unchanged.
//
// The code under test is the RegistryService publish pipeline + store
// (registry.ts / store.ts), built on core's signManifest/verifyManifest.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import fc from 'fast-check';

import {
  signManifest,
  verifyManifest,
  type PluginManifest,
} from 'streetjs';
import { createPublicKey } from 'node:crypto';

import { RegistryService, isRegistryError } from './registry.js';
import { RegistryStore } from './store.js';
import { PublisherDirectory } from './auth.js';
import type { PublishRequest } from './types.js';

const NUM_RUNS = 100;

// ── Fixed actors ──────────────────────────────────────────────────────────────
const NAMESPACE = 'acme';
const API_KEY = 'publisher-secret-key';
const V1 = '1.0.0';
const V2 = '2.0.0';

/** Fresh Ed25519 keypair (drawn per run). */
function ed25519(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync('ed25519');
}

/** SPKI PEM string for a public key, as the registry expects on publish. */
function pemOf(publicKey: KeyObject): string {
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

/** Build a publish request for a correctly-signed manifest. */
function buildSignedPublish(
  name: string,
  version: string,
  body: { capabilities: string[]; permissions: string[]; dependencies: Record<string, string> },
  privateKey: KeyObject,
  publicKeyPem: string,
): PublishRequest {
  const manifest: PluginManifest = {
    name,
    version,
    capabilities: body.capabilities,
    permissions: body.permissions as PluginManifest['permissions'],
    dependencies: body.dependencies,
  };
  const signed = signManifest(manifest, privateKey);
  return {
    manifest: signed,
    publicKeyPem,
    tarballBase64: Buffer.from(`${name}@${version}-content`).toString('base64'),
  };
}

/**
 * The set of installable versions: those that download successfully AND whose
 * stored manifest verifies under its recorded public key (the consumer-side
 * signature enforcement of Req 5.7). Returned as a sorted `name@version` list.
 */
function installableSet(service: RegistryService, names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const v of service.versions(name)) {
      const dl = service.download(name, v.version);
      if (isRegistryError(dl)) continue;
      let ok = false;
      try {
        ok = verifyManifest(dl.manifest, createPublicKey(dl.publicKeyPem));
      } catch {
        ok = false;
      }
      if (ok) out.push(`${name}@${v.version}`);
    }
  }
  return out.sort();
}

// ── Generators ────────────────────────────────────────────────────────────────
const suffixArb: fc.Arbitrary<string> = fc.hexaString({ minLength: 1, maxLength: 8 });

// A non-empty, non-whitespace token so generated manifests pass the registry's
// metadata validation (capabilities and dependency names must be non-empty
// after trimming).
const tokenArb: fc.Arbitrary<string> = fc.hexaString({ minLength: 1, maxLength: 10 });

const capabilitiesArb: fc.Arbitrary<string[]> = fc.array(tokenArb, { maxLength: 4 });
const permissionsArb: fc.Arbitrary<string[]> = fc.uniqueArray(
  fc.constantFrom('middleware', 'events', 'net', 'fs', 'db', 'secrets'),
  { maxLength: 6 },
);
const dependenciesArb: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  tokenArb,
  fc
    .tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 }))
    .map(([a, b, c]) => `^${a}.${b}.${c}`),
  { maxKeys: 3 },
);
const bodyArb = fc.record({
  capabilities: capabilitiesArb,
  permissions: permissionsArb,
  dependencies: dependenciesArb,
});

/** The kinds of invalid publish attempts the registry must reject (Req 4.4/4.10). */
type InvalidKind =
  | 'tampered-sig' // valid metadata, signature/checksum broken by post-sign mutation
  | 'foreign-key' // correctly signed, but published with a non-matching public key
  | 'duplicate' // re-publish of an already-published name@version
  | 'missing-version' // malformed metadata: no version
  | 'bad-version' // malformed metadata: non-semver version
  | 'empty-name'; // malformed metadata: empty identity

const invalidKindArb: fc.Arbitrary<InvalidKind> = fc.constantFrom(
  'tampered-sig',
  'foreign-key',
  'duplicate',
  'missing-version',
  'bad-version',
  'empty-name',
);

/**
 * Stand up a fresh registry with one authorized publisher and a single valid
 * version v1 already published. Returns the live service + the baseline facts.
 */
function freshRegistryWithV1(name: string, body: ReturnType<typeof bodyOf>) {
  const publishers = new PublisherDirectory();
  publishers.register('acme-publisher', API_KEY, [NAMESPACE]);
  const service = new RegistryService({ publishers, store: new RegistryStore() });

  const { publicKey, privateKey } = ed25519();
  const publicKeyPem = pemOf(publicKey);
  const v1Req = buildSignedPublish(name, V1, body, privateKey, publicKeyPem);
  const published = service.publish(API_KEY, v1Req);
  assert.ok(!isRegistryError(published), 'baseline v1 must publish successfully');

  return { service, privateKey, publicKey, publicKeyPem, v1Req };
}

// Tiny helper so the inline record type is inferable in freshRegistryWithV1.
function bodyOf(b: { capabilities: string[]; permissions: string[]; dependencies: Record<string, string> }) {
  return b;
}

// Feature: platform-leadership-gaps, Property 11: A rejected version never becomes installable and prior valid versions are preserved
// Validates: Requirements 4.4, 5.7, 5.8
describe('Property 11: a rejected version never becomes installable and prior valid versions are preserved', () => {
  it('rejects every invalid publish, returns an error, and leaves v1 served + the installable set unchanged', () => {
    fc.assert(
      fc.property(suffixArb, bodyArb, bodyArb, invalidKindArb, (suffix, v1Body, v2Body, kind) => {
        const name = `${NAMESPACE}/${suffix}`;
        const { service, privateKey, publicKey, publicKeyPem, v1Req } = freshRegistryWithV1(name, bodyOf(v1Body));

        // Snapshot the installable set BEFORE the rejected attempt.
        const before = installableSet(service, [name]);
        assert.deepEqual(before, [`${name}@${V1}`], 'baseline must expose exactly v1 as installable');

        // Build the invalid publish attempt.
        let badReq: PublishRequest;
        let attemptedVersion: string | null = V2; // null ⇒ no distinct artifact to look for
        let attemptedName = name;

        switch (kind) {
          case 'tampered-sig': {
            const req = buildSignedPublish(name, V2, bodyOf(v2Body), privateKey, publicKeyPem);
            // Mutate a signed field so the canonical body no longer matches the
            // recorded checksum ⇒ INTEGRITY_FAILED.
            const tampered: PluginManifest = {
              ...req.manifest,
              capabilities: [...(req.manifest.capabilities ?? []), '__tampered__'],
            };
            badReq = { ...req, manifest: tampered };
            break;
          }
          case 'foreign-key': {
            // Correctly signed with our key, but submitted with a foreign key's PEM.
            const req = buildSignedPublish(name, V2, bodyOf(v2Body), privateKey, publicKeyPem);
            const { publicKey: foreign } = ed25519();
            badReq = { ...req, publicKeyPem: pemOf(foreign) };
            break;
          }
          case 'duplicate': {
            // Re-publish the EXACT valid v1 ⇒ DUPLICATE. The "rejected version"
            // here is v1 itself, which legitimately stays served.
            badReq = v1Req;
            attemptedVersion = null;
            break;
          }
          case 'missing-version': {
            const req = buildSignedPublish(name, V2, bodyOf(v2Body), privateKey, publicKeyPem);
            const m = { ...req.manifest } as Record<string, unknown>;
            delete m.version;
            badReq = { ...req, manifest: m as unknown as PluginManifest };
            attemptedVersion = null;
            break;
          }
          case 'bad-version': {
            const req = buildSignedPublish(name, 'not-a-semver', bodyOf(v2Body), privateKey, publicKeyPem);
            badReq = req;
            attemptedVersion = 'not-a-semver';
            break;
          }
          case 'empty-name': {
            const req = buildSignedPublish('', V2, bodyOf(v2Body), privateKey, publicKeyPem);
            badReq = req;
            attemptedName = '';
            attemptedVersion = V2;
            break;
          }
        }

        // 1. The registry rejects with an error indication (Req 4.4).
        const result = service.publish(API_KEY, badReq);
        assert.ok(isRegistryError(result), `kind ${kind} must be rejected with a RegistryError`);

        // 2. The previously published valid version v1 is preserved and still
        //    served for installation (Req 4.4): download succeeds and the
        //    consumer-side signature verification passes (Req 5.7).
        const v1Download = service.download(name, V1);
        assert.ok(!isRegistryError(v1Download), 'v1 must still be downloadable after a rejected publish');
        assert.equal(
          verifyManifest((v1Download as { manifest: PluginManifest }).manifest, publicKey),
          true,
          'v1 must still verify under its publisher key (installable)',
        );
        const v1Verify = service.verify(name, V1);
        assert.ok(!isRegistryError(v1Verify) && v1Verify.valid === true, 'registry verify(v1) must be valid');

        // 3. The rejected version is NEVER served for installation (Req 4.4/5.8):
        //    a distinct attempted artifact must not be downloadable.
        if (attemptedVersion !== null) {
          const served = service.download(attemptedName, attemptedVersion);
          assert.ok(
            isRegistryError(served) && served.code === 'NOT_FOUND',
            `rejected ${attemptedName}@${attemptedVersion} must never be served`,
          );
        }

        // 4. The installable set is left unchanged — exactly v1 remains (Req 5.7).
        const probeNames = [...new Set([name, attemptedName].filter((n) => n !== ''))];
        const after = installableSet(service, probeNames);
        assert.deepEqual(after, before, 'the installable set must be unchanged by a rejected publish');
        assert.deepEqual(
          service.versions(name).map((v) => v.version),
          [V1],
          'the stored version history of the plugin must be unchanged',
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('preserves v1 even when MULTIPLE successive invalid publishes are attempted', () => {
    fc.assert(
      fc.property(suffixArb, bodyArb, fc.array(invalidKindArb, { minLength: 1, maxLength: 6 }), (suffix, v1Body, kinds) => {
        const name = `${NAMESPACE}/${suffix}`;
        const { service, privateKey, publicKey, publicKeyPem, v1Req } = freshRegistryWithV1(name, bodyOf(v1Body));

        for (const kind of kinds) {
          let badReq: PublishRequest;
          switch (kind) {
            case 'tampered-sig': {
              const req = buildSignedPublish(name, V2, bodyOf(v1Body), privateKey, publicKeyPem);
              badReq = {
                ...req,
                manifest: { ...req.manifest, capabilities: [...(req.manifest.capabilities ?? []), '__x__'] },
              };
              break;
            }
            case 'foreign-key': {
              const req = buildSignedPublish(name, V2, bodyOf(v1Body), privateKey, publicKeyPem);
              badReq = { ...req, publicKeyPem: pemOf(ed25519().publicKey) };
              break;
            }
            case 'duplicate':
              badReq = v1Req;
              break;
            case 'missing-version': {
              const req = buildSignedPublish(name, V2, bodyOf(v1Body), privateKey, publicKeyPem);
              const m = { ...req.manifest } as Record<string, unknown>;
              delete m.version;
              badReq = { ...req, manifest: m as unknown as PluginManifest };
              break;
            }
            case 'bad-version':
              badReq = buildSignedPublish(name, 'x.y.z', bodyOf(v1Body), privateKey, publicKeyPem);
              break;
            case 'empty-name':
              badReq = buildSignedPublish('', V2, bodyOf(v1Body), privateKey, publicKeyPem);
              break;
          }
          assert.ok(isRegistryError(service.publish(API_KEY, badReq)), `kind ${kind} must be rejected`);
        }

        // After ALL rejected attempts, v1 is intact and is the sole installable.
        assert.deepEqual(installableSet(service, [name]), [`${name}@${V1}`]);
        assert.deepEqual(service.versions(name).map((v) => v.version), [V1]);
        const dl = service.download(name, V1);
        assert.ok(!isRegistryError(dl));
        assert.equal(verifyManifest((dl as { manifest: PluginManifest }).manifest, publicKey), true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
