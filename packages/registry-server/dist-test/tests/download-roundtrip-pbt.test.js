// tests/download-roundtrip-pbt.test.ts
// Property-based test for the Network Plugin Registry download round trip
// (Req 4.3 — when a plugin is downloaded, the registry provides the plugin
//  package TOGETHER WITH its recorded Ed25519 signature so the consumer can
//  perform integrity validation).
//
// The property under test is byte-faithfulness: whatever tarball bytes are
// published, a subsequent download yields exactly those bytes back (no
// truncation, padding, re-encoding, or corruption), alongside the exact
// signature recorded at publish time. This is what lets a consumer re-run
// integrity validation against the download and have it pass.
//
// The code under test is `RegistryService.publish` + `RegistryService.download`
// in registry.ts, which carry the tarball through a base64 → Buffer → base64
// transcoding boundary that the round trip must survive intact.
//
// Kept in its own file so the universal "download === publish, byte-for-byte"
// property is exercised across many generated tarballs + signed manifests
// without clobbering the example/edge-case unit tests elsewhere.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import fc from 'fast-check';
import { RegistryService, isRegistryError } from '../registry.js';
import { PublisherDirectory } from '../auth.js';
import { signManifest, verifyManifest, manifestChecksum } from 'streetjs';
const NUM_RUNS = 100;
// ── Generators ────────────────────────────────────────────────────────────────
//
// A WELL-FORMED manifest (so publish reaches the storage step) under the `acme`
// namespace our test publisher owns, plus ARBITRARY tarball bytes — including
// the empty buffer and bytes that exercise every value 0..255 — so the round
// trip is tested across the full byte space, not just printable ASCII.
const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const TOKEN_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789-_';
const wordArb = fc
    .array(fc.constantFrom(...ALPHA.split('')), { minLength: 1, maxLength: 10 })
    .map((cs) => cs.join(''));
const tokenArb = fc
    .array(fc.constantFrom(...TOKEN_CHARS.split('')), { minLength: 1, maxLength: 10 })
    .map((cs) => cs.join(''));
const versionArb = fc
    .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }), fc.nat({ max: 50 }))
    .map(([a, b, c]) => `${a}.${b}.${c}`);
const capabilitiesArb = fc.array(tokenArb, { maxLength: 5 });
const dependenciesArb = fc.dictionary(tokenArb, versionArb.map((v) => `^${v}`), { maxKeys: 4 });
const wellFormedArb = fc.record({
    name: wordArb.map((w) => `acme/${w}`),
    version: versionArb,
    capabilities: fc.option(capabilitiesArb, { nil: undefined }),
    dependencies: fc.option(dependenciesArb, { nil: undefined }),
}, { requiredKeys: ['name', 'version'] });
/** Arbitrary raw tarball bytes, including the empty buffer (full byte space). */
const tarballArb = fc
    .uint8Array({ minLength: 0, maxLength: 512 })
    .map((u8) => Buffer.from(u8));
// ── Publish-pipeline helpers ──────────────────────────────────────────────────
const FIXED_NOW = () => new Date('2024-01-01T00:00:00.000Z');
/** A fresh registry whose sole publisher owns the `acme` namespace, plus a keypair. */
function freshService() {
    const apiKey = 'publisher-secret-key';
    const publishers = new PublisherDirectory();
    publishers.register('acme-pub', apiKey, ['acme']);
    const service = new RegistryService({ publishers, now: FIXED_NOW });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
    return { service, apiKey, privateKey, publicKeyPem };
}
/** A fully valid, signed manifest from a well-formed base. */
function signFor(base, privateKey) {
    return signManifest({
        name: base.name,
        version: base.version,
        capabilities: base.capabilities ?? [],
        dependencies: base.dependencies ?? {},
        permissions: [],
    }, privateKey);
}
// Feature: platform-leadership-gaps, Property 9: Download is a byte-faithful round trip
// Validates: Requirements 4.3
describe('Property 9: download is a byte-faithful round trip', () => {
    it('download returns the published tarball bytes EXACTLY, with its recorded signature (Req 4.3)', () => {
        fc.assert(fc.property(wellFormedArb, tarballArb, (base, tarball) => {
            const { service, apiKey, privateKey, publicKeyPem } = freshService();
            const manifest = signFor(base, privateKey);
            const tarballBase64 = tarball.toString('base64');
            const published = service.publish(apiKey, { manifest, publicKeyPem, tarballBase64 });
            assert.ok(!isRegistryError(published), `publish should succeed: ${JSON.stringify(published)}`);
            const download = service.download(base.name, base.version);
            assert.ok(!isRegistryError(download), `download should succeed: ${JSON.stringify(download)}`);
            if (isRegistryError(download))
                return; // narrow for TS
            // 1. Byte-faithful tarball: decoding the downloaded base64 yields the
            //    exact bytes that were published (length + every byte identical).
            const downloadedBytes = Buffer.from(download.tarballBase64, 'base64');
            assert.equal(downloadedBytes.length, tarball.length, 'tarball length must be preserved');
            assert.ok(downloadedBytes.equals(tarball), 'downloaded tarball bytes must equal the published bytes');
            // 2. The recorded signature is provided alongside the package (Req 4.3),
            //    and it is exactly the signature recorded on the published manifest.
            assert.equal(download.signature, manifest.signature, 'download must carry the recorded signature');
            assert.equal(download.manifest.signature, manifest.signature);
            // 3. The recorded checksum is the SHA-256 of the published bytes, so the
            //    consumer can validate integrity against the downloaded payload.
            const expectedChecksum = createHash('sha256').update(tarball).digest('hex');
            assert.equal(download.tarballChecksum, expectedChecksum, 'tarball checksum must hash the published bytes');
            assert.equal(createHash('sha256').update(downloadedBytes).digest('hex'), download.tarballChecksum, 'downloaded bytes must re-hash to the recorded checksum');
        }), { numRuns: NUM_RUNS });
    });
    it('the downloaded package + recorded signature pass consumer-side integrity validation (Req 4.3)', () => {
        fc.assert(fc.property(wellFormedArb, tarballArb, (base, tarball) => {
            const { service, apiKey, privateKey, publicKeyPem } = freshService();
            const manifest = signFor(base, privateKey);
            const published = service.publish(apiKey, {
                manifest,
                publicKeyPem,
                tarballBase64: tarball.toString('base64'),
            });
            assert.ok(!isRegistryError(published));
            const download = service.download(base.name, base.version);
            assert.ok(!isRegistryError(download));
            if (isRegistryError(download))
                return;
            // A consumer can take the downloaded package + recorded signature and
            // re-run the same Ed25519 + checksum validation the registry performed,
            // and it passes — which is the whole point of shipping the signature
            // alongside the package (Req 4.3).
            const consumerKey = createPublicKey(download.publicKeyPem);
            assert.equal(download.manifest.checksum, manifestChecksum(download.manifest));
            assert.equal(verifyManifest(download.manifest, consumerKey), true);
        }), { numRuns: NUM_RUNS });
    });
    it('round-trips multiple distinct versions independently and byte-faithfully (Req 4.3)', () => {
        fc.assert(fc.property(wellFormedArb, versionArb, versionArb, tarballArb, tarballArb, (base, vA, vB, tarA, tarB) => {
            // Two distinct versions of the same plugin must each download back
            // their OWN bytes — no cross-contamination between stored versions.
            fc.pre(vA !== vB);
            const { service, apiKey, privateKey, publicKeyPem } = freshService();
            const mA = signFor({ ...base, version: vA }, privateKey);
            const mB = signFor({ ...base, version: vB }, privateKey);
            assert.ok(!isRegistryError(service.publish(apiKey, { manifest: mA, publicKeyPem, tarballBase64: tarA.toString('base64') })));
            assert.ok(!isRegistryError(service.publish(apiKey, { manifest: mB, publicKeyPem, tarballBase64: tarB.toString('base64') })));
            const dA = service.download(base.name, vA);
            const dB = service.download(base.name, vB);
            assert.ok(!isRegistryError(dA) && !isRegistryError(dB));
            if (isRegistryError(dA) || isRegistryError(dB))
                return;
            assert.ok(Buffer.from(dA.tarballBase64, 'base64').equals(tarA), 'version A bytes preserved');
            assert.ok(Buffer.from(dB.tarballBase64, 'base64').equals(tarB), 'version B bytes preserved');
            assert.equal(dA.signature, mA.signature);
            assert.equal(dB.signature, mB.signature);
        }), { numRuns: NUM_RUNS });
    });
});
//# sourceMappingURL=download-roundtrip-pbt.test.js.map