// scripts/tests/keyless-identity.test.mjs
// Unit tests for the keyless-signing identity policy (RFC 0005). The decisive
// test is the NEGATIVE one: a valid Fulcio cert from a DIFFERENT repo/workflow
// must be rejected — that is the attack the identity pin exists to stop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesIdentity, cosignVerifyArgs, PINNED_IDENTITY } from '../security/keyless-identity.mjs';

const good = {
  issuer: 'https://token.actions.githubusercontent.com',
  identity: 'https://github.com/hassanmubiru/StreetJS/.github/workflows/publish-plugins.yml@refs/tags/plugins-v1.0.4',
};

test('accepts the pinned publish-workflow identity on a plugins release tag', () => {
  assert.equal(matchesIdentity(good), true);
});

test('REJECTS a valid cert from a different repository', () => {
  assert.equal(matchesIdentity({
    ...good,
    identity: 'https://github.com/attacker/evil/.github/workflows/publish-plugins.yml@refs/tags/plugins-v1.0.4',
  }), false);
});

test('REJECTS a different workflow in the same repository', () => {
  assert.equal(matchesIdentity({
    ...good,
    identity: 'https://github.com/hassanmubiru/StreetJS/.github/workflows/ci-cd.yml@refs/tags/plugins-v1.0.4',
  }), false);
});

test('REJECTS a non-release ref (e.g. a branch)', () => {
  assert.equal(matchesIdentity({
    ...good,
    identity: 'https://github.com/hassanmubiru/StreetJS/.github/workflows/publish-plugins.yml@refs/heads/main',
  }), false);
});

test('REJECTS a wrong OIDC issuer', () => {
  assert.equal(matchesIdentity({ ...good, issuer: 'https://evil.example.com' }), false);
});

test('REJECTS malformed / missing identity input', () => {
  assert.equal(matchesIdentity(null), false);
  assert.equal(matchesIdentity({}), false);
  assert.equal(matchesIdentity({ issuer: good.issuer }), false);
});

test('cosignVerifyArgs pins issuer + identity regexp and targets the bundle', () => {
  const args = cosignVerifyArgs('manifest.json', 'manifest.cosign.bundle');
  assert.ok(args.includes('verify-blob'));
  assert.equal(args[args.indexOf('--bundle') + 1], 'manifest.cosign.bundle');
  assert.equal(args[args.indexOf('--certificate-oidc-issuer') + 1], PINNED_IDENTITY.issuer);
  assert.equal(args[args.indexOf('--certificate-identity-regexp') + 1], PINNED_IDENTITY.identityRegexp);
  assert.equal(args[args.length - 1], 'manifest.json');
});
