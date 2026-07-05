// tests/publish-authz-pbt.test.ts
// Property-based test for the Network Plugin Registry publish authentication &
// authorization gate (Req 4.9 — when a plugin is published, the registry SHALL
// require an authenticated AND authorized publisher identity and SHALL reject
// the publish request when the publisher is not authenticated or not
// authorized).
//
// The code under test is `RegistryService.publish` together with its
// `PublisherDirectory` (AuthN: bearer token matched by SHA-256 hash; AuthZ:
// namespace ownership). The publish pipeline gates in a fixed order:
//   1. authenticate bearer token           → UNAUTHENTICATED
//   2. validate manifest metadata          → INVALID_MANIFEST
//   3. authorize publisher for namespace   → UNAUTHORIZED
// so authentication is the FIRST gate (it fires even for a malformed manifest)
// and authorization is reached only once the credential is valid and the
// metadata is well-formed.
//
// Kept in its own file so the universal "rejects unless authenticated AND
// authorized, and the stored plugin set is unchanged on rejection" property is
// exercised across many generated credentials, namespaces, and manifests
// without clobbering example/edge-case unit tests elsewhere.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fc from 'fast-check';
import { RegistryService, isRegistryError } from '../registry.js';
import { PublisherDirectory } from '../auth.js';
import { signManifest } from 'streetjs';
const NUM_RUNS = 100;
// The single owned namespace + the raw bearer token of our sole publisher.
const OWNED_NS = 'acme';
const VALID_API_KEY = 'publisher-secret-key';
const FIXED_NOW = () => new Date('2024-01-01T00:00:00.000Z');
// ── Generators ────────────────────────────────────────────────────────────────
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const wordArb = fc
    .array(fc.constantFrom(...ALPHA.split('')), { minLength: 1, maxLength: 10 })
    .map((cs) => cs.join(''));
const versionArb = fc
    .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }), fc.nat({ max: 50 }))
    .map(([a, b, c]) => `${a}.${b}.${c}`);
/** A namespace the sole publisher does NOT own (never equal to OWNED_NS). */
const unownedNamespaceArb = wordArb
    .map((w) => `not-${w}`)
    .filter((ns) => ns !== OWNED_NS);
/** A plugin name in a namespace the publisher OWNS (`acme/x` or `@acme/x`). */
const ownedNameArb = fc
    .tuple(fc.boolean(), wordArb)
    .map(([scoped, w]) => (scoped ? `@${OWNED_NS}/${w}` : `${OWNED_NS}/${w}`));
/** A plugin name in a namespace the publisher does NOT own. */
const unownedNameArb = fc
    .tuple(fc.boolean(), unownedNamespaceArb, wordArb)
    .map(([scoped, ns, w]) => (scoped ? `@${ns}/${w}` : `${ns}/${w}`));
const ownedSeedArb = fc.record({ name: ownedNameArb, version: versionArb });
const unownedSeedArb = fc.record({ name: unownedNameArb, version: versionArb });
/**
 * A bad credential: every shape that must FAIL authentication — absent,
 * empty/whitespace, or any string that is not the registered API key. Matched
 * by SHA-256 hash, so a non-equal string can never authenticate.
 */
const badCredentialArb = fc.oneof(fc.constant(undefined), fc.constantFrom('', '   ', 'Bearer', 'null'), fc.string({ maxLength: 40 }).filter((s) => s !== VALID_API_KEY));
// ── Helpers ───────────────────────────────────────────────────────────────────
/** A fresh registry whose sole publisher owns ONLY the `acme` namespace. */
function freshService() {
    const publishers = new PublisherDirectory();
    publishers.register('acme-pub', VALID_API_KEY, [OWNED_NS]);
    const service = new RegistryService({ publishers, now: FIXED_NOW });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    return { service, privateKey, publicKeyPem };
}
/** Build a fully valid, signed publish request from a manifest seed. */
function signedRequest(seed, privateKey, publicKeyPem) {
    const manifest = signManifest({ name: seed.name, version: seed.version, capabilities: [], dependencies: {}, permissions: [] }, privateKey);
    return { manifest, publicKeyPem, tarballBase64: Buffer.from(`tarball-${seed.name}@${seed.version}`).toString('base64') };
}
/** Total number of stored versions across every plugin (a store-state snapshot). */
function totalVersions(service) {
    return service.store.names().reduce((sum, name) => sum + service.versions(name).length, 0);
}
/**
 * Seed the registry with one valid, owned version so each rejection can be shown
 * to leave the prior valid version intact (Req 4.9: "the stored plugin set is
 * unchanged"). Returns the seeded coordinates.
 */
function seedValidVersion(service, privateKey, publicKeyPem) {
    const name = `${OWNED_NS}/seed-plugin`;
    const version = '1.0.0';
    const res = service.publish(VALID_API_KEY, signedRequest({ name, version }, privateKey, publicKeyPem));
    assert.ok(!isRegistryError(res), 'seed publish should succeed');
    return { name, version };
}
// Feature: platform-leadership-gaps, Property 13: Publishing requires authentication and authorization
// Validates: Requirements 4.9
describe('Property 13: publishing requires authentication and authorization', () => {
    it('rejects an unauthenticated publish (UNAUTHENTICATED) and leaves the store unchanged', () => {
        fc.assert(fc.property(ownedSeedArb, badCredentialArb, (seed, badKey) => {
            const { service, privateKey, publicKeyPem } = freshService();
            const seeded = seedValidVersion(service, privateKey, publicKeyPem);
            const before = totalVersions(service);
            // The manifest is otherwise valid and even in an OWNED namespace — only
            // the credential is bad, so authentication alone must reject it.
            const res = service.publish(badKey, signedRequest(seed, privateKey, publicKeyPem));
            assert.ok(isRegistryError(res), `bad credential must be rejected, got: ${JSON.stringify(res)}`);
            assert.equal(res.code, 'UNAUTHENTICATED');
            // Store is byte-for-byte unchanged: no new version, seed still present.
            assert.equal(totalVersions(service), before);
            assert.equal(service.store.hasVersion(seed.name, seed.version), false);
            assert.ok(!isRegistryError(service.download(seeded.name, seeded.version)), 'seed must remain downloadable');
        }), { numRuns: NUM_RUNS });
    });
    it('authentication is the first gate: a bad credential is rejected even for a malformed manifest', () => {
        fc.assert(fc.property(badCredentialArb, fc.constantFrom(null, 42, 'str', {}, { name: '' }, undefined), (badKey, malformed) => {
            const { service, privateKey, publicKeyPem } = freshService();
            const before = totalVersions(service);
            const res = service.publish(badKey, {
                manifest: malformed,
                publicKeyPem,
                tarballBase64: Buffer.from('x').toString('base64'),
            });
            // A malformed manifest would otherwise yield INVALID_MANIFEST, but
            // authentication runs first, so the response is UNAUTHENTICATED.
            assert.ok(isRegistryError(res));
            assert.equal(res.code, 'UNAUTHENTICATED');
            assert.equal(totalVersions(service), before);
        }), { numRuns: NUM_RUNS });
    });
    it('rejects an authenticated-but-unauthorized publish (UNAUTHORIZED) and leaves the store unchanged', () => {
        fc.assert(fc.property(unownedSeedArb, (seed) => {
            const { service, privateKey, publicKeyPem } = freshService();
            const seeded = seedValidVersion(service, privateKey, publicKeyPem);
            const before = totalVersions(service);
            // Valid credential + valid signed manifest, but the namespace is NOT
            // owned by the publisher, so authorization must reject it.
            const res = service.publish(VALID_API_KEY, signedRequest(seed, privateKey, publicKeyPem));
            assert.ok(isRegistryError(res), `unauthorized namespace must be rejected, got: ${JSON.stringify(res)}`);
            assert.equal(res.code, 'UNAUTHORIZED');
            assert.equal(res.field, 'name');
            // Store is unchanged: the unauthorized version was never stored and the
            // seeded valid version is preserved.
            assert.equal(totalVersions(service), before);
            assert.equal(service.store.hasVersion(seed.name, seed.version), false);
            assert.ok(!isRegistryError(service.download(seeded.name, seeded.version)), 'seed must remain downloadable');
        }), { numRuns: NUM_RUNS });
    });
    it('accepts a publish that is BOTH authenticated and authorized (completeness)', () => {
        fc.assert(fc.property(ownedSeedArb, (seed) => {
            const { service, privateKey, publicKeyPem } = freshService();
            // Avoid a duplicate collision with the implicit fresh store (empty here).
            const res = service.publish(VALID_API_KEY, signedRequest(seed, privateKey, publicKeyPem));
            assert.ok(!isRegistryError(res), `authenticated+authorized publish must succeed, got: ${JSON.stringify(res)}`);
            assert.equal(service.store.hasVersion(seed.name, seed.version), true);
            assert.equal(totalVersions(service), 1);
        }), { numRuns: NUM_RUNS });
    });
});
//# sourceMappingURL=publish-authz-pbt.test.js.map