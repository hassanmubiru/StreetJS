// tests/manifest-metadata-pbt.test.ts
// Property-based test for the Network Plugin Registry manifest metadata gate
// (Req 4.5 — validate the Plugin Manifest metadata BEFORE accepting a plugin;
//  Req 4.10 — reject when a published manifest is missing a required field,
//  duplicates an existing identity-and-version pair, or is malformed, returning
//  an error that identifies the offending metadata).
//
// The code under test is `validateManifestMetadata` (the pure metadata gate) and
// `RegistryService.publish` (the full publish pipeline that runs the gate before
// accepting, rejects duplicates, and never mutates the store on rejection).
//
// Kept in its own file so the universal "accepts iff well-formed and
// non-duplicate" property is exercised across many generated manifests without
// clobbering example/edge-case unit tests elsewhere.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import fc from 'fast-check';

import { validateManifestMetadata } from '../validation.js';
import { RegistryService, isRegistryError } from '../registry.js';
import { PublisherDirectory } from '../auth.js';
import { signManifest, type PluginManifest } from 'streetjs';

const NUM_RUNS = 100;

// ── Generators ────────────────────────────────────────────────────────────────
//
// A WELL-FORMED manifest per the documented contract in validation.ts:
//   - name: required, non-empty string (here always `acme/<word>` so the
//     namespace is `acme`, which our test publisher owns)
//   - version: required, semver MAJOR.MINOR.PATCH
//   - capabilities?: when present, array of non-empty strings
//   - dependencies?: when present, Record<non-empty-name, non-empty-range>
//   - permissions?: when present, array of strings

const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const TOKEN_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789-_';

const wordArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ALPHA.split('')), { minLength: 1, maxLength: 10 })
  .map((cs) => cs.join(''));

/** A non-empty, non-whitespace token (safe for capability names + dep keys). */
const tokenArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...TOKEN_CHARS.split('')), { minLength: 1, maxLength: 10 })
  .map((cs) => cs.join(''));

const versionArb: fc.Arbitrary<string> = fc
  .tuple(fc.nat({ max: 50 }), fc.nat({ max: 50 }), fc.nat({ max: 50 }))
  .map(([a, b, c]) => `${a}.${b}.${c}`);

const capabilitiesArb: fc.Arbitrary<string[]> = fc.array(tokenArb, { maxLength: 5 });

const dependenciesArb: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  tokenArb,
  versionArb.map((v) => `^${v}`),
  { maxKeys: 4 },
);

const permissionsArb: fc.Arbitrary<string[]> = fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 });

/** Loose shape for a generated well-formed manifest (optionals may be absent). */
interface WellFormed {
  name: string;
  version: string;
  capabilities?: string[];
  dependencies?: Record<string, string>;
  permissions?: string[];
}

const wellFormedArb: fc.Arbitrary<WellFormed> = fc.record(
  {
    name: wordArb.map((w) => `acme/${w}`),
    version: versionArb,
    capabilities: fc.option(capabilitiesArb, { nil: undefined }),
    dependencies: fc.option(dependenciesArb, { nil: undefined }),
    permissions: fc.option(permissionsArb, { nil: undefined }),
  },
  { requiredKeys: ['name', 'version'] },
);

// ── Defects ─────────────────────────────────────────────────────────────────
//
// Each defect injects exactly ONE malformation into an otherwise well-formed
// manifest and records the metadata `field` the validator MUST name. Because the
// base is well-formed and the validator checks fields in a fixed order (name →
// version → capabilities → dependencies → permissions), the injected defect is
// always the first (and only) failure.

interface Defect {
  kind: string;
  field: string;
  // The replacement value for value-bearing defects.
  value?: unknown;
}

const defectArb: fc.Arbitrary<Defect> = fc.oneof(
  // The manifest itself is not an object (null / primitive / undefined).
  fc.record({
    kind: fc.constant('not-object'),
    field: fc.constant('manifest'),
    value: fc.constantFrom<unknown>(null, 42, 'a string', true, undefined),
  }),
  // name
  fc.record({ kind: fc.constant('name-missing'), field: fc.constant('name') }),
  fc.record({ kind: fc.constant('name-empty'), field: fc.constant('name'), value: fc.constantFrom('', '   ') }),
  fc.record({ kind: fc.constant('name-type'), field: fc.constant('name'), value: fc.constantFrom<unknown>(123, true, {}) }),
  // version
  fc.record({ kind: fc.constant('version-missing'), field: fc.constant('version') }),
  fc.record({ kind: fc.constant('version-empty'), field: fc.constant('version'), value: fc.constantFrom('', '  ') }),
  fc.record({
    kind: fc.constant('version-malformed'),
    field: fc.constant('version'),
    value: fc.constantFrom('abc', '1', '1.2', '1.2.3.4', 'x.y.z', '1.0'),
  }),
  // capabilities
  fc.record({
    kind: fc.constant('capabilities-type'),
    field: fc.constant('capabilities'),
    value: fc.constantFrom<unknown>('nope', 123, true),
  }),
  fc.record({
    kind: fc.constant('capabilities-item'),
    field: fc.constant('capabilities'),
    value: fc.constantFrom<unknown>(['ok', ''], ['ok', 5], ['  ']),
  }),
  // dependencies
  fc.record({
    kind: fc.constant('deps-type'),
    field: fc.constant('dependencies'),
    value: fc.constantFrom<unknown>(['a'], 5, 'x'),
  }),
  fc.record({
    kind: fc.constant('deps-empty-name'),
    field: fc.constant('dependencies'),
    value: fc.constant<unknown>({ '': '^1.0.0' }),
  }),
  fc.record({
    kind: fc.constant('deps-range'),
    field: fc.constant('dependencies.somepkg'),
    value: fc.constantFrom<unknown>({ somepkg: '' }, { somepkg: 5 }),
  }),
  // permissions
  fc.record({
    kind: fc.constant('perms-type'),
    field: fc.constant('permissions'),
    value: fc.constantFrom<unknown>('x', 5, true),
  }),
  fc.record({
    kind: fc.constant('perms-item'),
    field: fc.constant('permissions'),
    value: fc.constantFrom<unknown>(['ok', 5], [1, 2]),
  }),
);

/** Produce a malformed manifest by applying `defect` to a well-formed base. */
function applyDefect(base: WellFormed, defect: Defect): unknown {
  if (defect.kind === 'not-object') return defect.value;
  const m: Record<string, unknown> = { ...base };
  switch (defect.kind) {
    case 'name-missing':
      delete m.name;
      break;
    case 'name-empty':
    case 'name-type':
      m.name = defect.value;
      break;
    case 'version-missing':
      delete m.version;
      break;
    case 'version-empty':
    case 'version-malformed':
      m.version = defect.value;
      break;
    case 'capabilities-type':
    case 'capabilities-item':
      m.capabilities = defect.value;
      break;
    case 'deps-type':
    case 'deps-empty-name':
    case 'deps-range':
      m.dependencies = defect.value;
      break;
    case 'perms-type':
    case 'perms-item':
      m.permissions = defect.value;
      break;
    default:
      throw new Error(`unknown defect kind ${defect.kind}`);
  }
  return m;
}

// ── Publish-pipeline helpers ──────────────────────────────────────────────────

const FIXED_NOW = () => new Date('2024-01-01T00:00:00.000Z');

/** A fresh registry whose sole publisher owns the `acme` namespace, plus a keypair. */
function freshService(): {
  service: RegistryService;
  apiKey: string;
  privateKey: KeyObject;
  publicKeyPem: string;
} {
  const apiKey = 'publisher-secret-key';
  const publishers = new PublisherDirectory();
  publishers.register('acme-pub', apiKey, ['acme']);
  const service = new RegistryService({ publishers, now: FIXED_NOW });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  return { service, apiKey, privateKey, publicKeyPem };
}

/** Build a fully valid, signed publish request from a well-formed base manifest. */
function signedRequest(base: WellFormed, privateKey: KeyObject, publicKeyPem: string) {
  const manifest = signManifest(
    {
      name: base.name,
      version: base.version,
      capabilities: base.capabilities ?? [],
      dependencies: base.dependencies ?? {},
      permissions: (base.permissions ?? []) as PluginManifest['permissions'],
    } as PluginManifest,
    privateKey,
  );
  return { manifest, publicKeyPem, tarballBase64: Buffer.from(`tarball-${base.name}`).toString('base64') };
}

// Feature: platform-leadership-gaps, Property 10: Manifest metadata validation accepts iff well-formed and non-duplicate
// Validates: Requirements 4.5, 4.10
describe('Property 10: manifest metadata validation accepts iff well-formed and non-duplicate', () => {
  it('accepts every well-formed manifest (validateManifestMetadata returns null)', () => {
    fc.assert(
      fc.property(wellFormedArb, (base) => {
        assert.equal(
          validateManifestMetadata(base),
          null,
          `well-formed manifest was rejected: ${JSON.stringify(base)}`,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects malformed metadata and names the offending field (Req 4.10)', () => {
    fc.assert(
      fc.property(wellFormedArb, defectArb, (base, defect) => {
        const malformed = applyDefect(base, defect);
        const error = validateManifestMetadata(malformed);

        assert.notEqual(error, null, `malformed manifest (${defect.kind}) was accepted`);
        assert.equal(error!.code, 'INVALID_MANIFEST');
        assert.equal(
          error!.field,
          defect.field,
          `expected offending field "${defect.field}" for defect ${defect.kind}, got "${error!.field}"`,
        );
        assert.equal(typeof error!.message, 'string');
        assert.ok(error!.message.length > 0, 'error must carry a human-readable message');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('publish accepts a well-formed, signed, non-duplicate manifest and stores it (Req 4.5)', () => {
    fc.assert(
      fc.property(wellFormedArb, (base) => {
        const { service, apiKey, privateKey, publicKeyPem } = freshService();
        const req = signedRequest(base, privateKey, publicKeyPem);

        const res = service.publish(apiKey, req);

        assert.ok(!isRegistryError(res), `expected accept, got error: ${JSON.stringify(res)}`);
        // The accepted version is now stored and downloadable.
        assert.equal(service.store.hasVersion(base.name, base.version), true);
        assert.equal(service.versions(base.name).length, 1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('publish rejects a duplicate name@version and preserves the stored version (Req 4.10)', () => {
    fc.assert(
      fc.property(wellFormedArb, (base) => {
        const { service, apiKey, privateKey, publicKeyPem } = freshService();
        const req = signedRequest(base, privateKey, publicKeyPem);

        const first = service.publish(apiKey, req);
        assert.ok(!isRegistryError(first), 'first publish should succeed');

        const before = service.versions(base.name).length;
        const dup = service.publish(apiKey, req);

        assert.ok(isRegistryError(dup), 'duplicate publish must be rejected');
        assert.equal((dup as { code: string }).code, 'DUPLICATE');
        assert.equal((dup as { field?: string }).field, 'version');

        // Store is unchanged and the prior valid version remains downloadable.
        assert.equal(service.versions(base.name).length, before);
        const download = service.download(base.name, base.version);
        assert.ok(!isRegistryError(download), 'prior version must remain downloadable');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('publish rejects malformed metadata, names the field, and leaves prior versions intact (Req 4.10)', () => {
    fc.assert(
      fc.property(wellFormedArb, wellFormedArb, defectArb, (seed, base, defect) => {
        const { service, apiKey, privateKey, publicKeyPem } = freshService();

        // Seed the registry with one valid version so we can prove preservation.
        const seedReq = signedRequest(seed, privateKey, publicKeyPem);
        const seeded = service.publish(apiKey, seedReq);
        assert.ok(!isRegistryError(seeded), 'seed publish should succeed');
        const seedCount = service.versions(seed.name).length;

        // Attempt a malformed publish. Metadata validation runs BEFORE storage.
        const malformed = applyDefect(base, defect);
        const res = service.publish(apiKey, {
          manifest: malformed as PluginManifest,
          publicKeyPem,
          tarballBase64: Buffer.from('whatever').toString('base64'),
        });

        assert.ok(isRegistryError(res), `malformed publish (${defect.kind}) must be rejected`);
        assert.equal((res as { code: string }).code, 'INVALID_MANIFEST');
        assert.equal((res as { field?: string }).field, defect.field);

        // The store never mutated: the seeded valid version is preserved.
        assert.equal(service.versions(seed.name).length, seedCount);
        assert.ok(!isRegistryError(service.download(seed.name, seed.version)));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
