// scripts/tests/plugin-integration-harness.test.mjs
//
// Unit tests for the Official Plugin Ecosystem Layer-B integration verification
// (Requirement 5.9). These exercise the harness's pure, infra-free logic:
//
//   • the official-plugin registry covers exactly the Req 5.1–5.4 set, and every
//     entry declares a well-formed dotted capability id (`plugin.<id>`);
//   • the credential probe returns the SPECIFIC first missing env-var id (the
//     honest BLOCKED prerequisite) and `null` once every credential is present;
//   • each plugin probe returns either `null` (backing service/account present)
//     or a well-formed BlockedReason `{ missingPrerequisite, kind }` — the shape
//     the runner needs to record an honest BLOCKED.
//
// The real round trips (Redis container, S3/R2 buckets, vendor sandbox calls)
// are Layer B and are covered by the `plugin.<id>` Verification Artifacts
// produced through CommandRunner; they are intentionally NOT run here so the
// unit suite stays green without infrastructure or credentials.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLUGINS,
  PLUGIN_IDS,
  resolvePlugin,
  missingCredential,
  firstEnv,
} from '../plugins/lib.mjs';

const CAPABILITY_ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const VALID_KINDS = ['service', 'credential', 'runtime', 'timeout'];

// The fixed official-plugin set mandated by Requirements 5.1–5.4.
const EXPECTED_IDS = ['redis', 's3', 'r2', 'twilio', 'sendgrid', 'stripe', 'auth0'];

describe('official plugin integration registry — pure logic', () => {
  it('covers exactly the Req 5.1–5.4 official plugin set', () => {
    assert.deepEqual([...PLUGIN_IDS].sort(), [...EXPECTED_IDS].sort());
  });

  it('every entry declares a well-formed dotted capability id of the form plugin.<id>', () => {
    for (const id of PLUGIN_IDS) {
      const plugin = PLUGINS[id];
      assert.equal(plugin.capabilityId, `plugin.${id}`, `capabilityId for ${id}`);
      assert.ok(CAPABILITY_ID_PATTERN.test(plugin.capabilityId), `capabilityId pattern for ${id}`);
      assert.ok(['container', 'account'].includes(plugin.backing), `backing kind for ${id}`);
      assert.equal(typeof plugin.probe, 'function', `probe present for ${id}`);
    }
  });

  it('resolvePlugin returns the entry for a known id and throws for an unknown id', () => {
    assert.equal(resolvePlugin('s3').capabilityId, 'plugin.s3');
    assert.throws(() => resolvePlugin('nope'), /unknown plugin id/);
  });
});

describe('credential probe — honest BLOCKED prerequisite id', () => {
  const SAVED = {};
  const TOUCHED = ['A_FIRST', 'B_SECOND', 'C_THIRD'];

  afterEach(() => {
    for (const k of TOUCHED) {
      if (k in SAVED) process.env[k] = SAVED[k];
      else delete process.env[k];
      delete SAVED[k];
    }
  });

  function clear(...names) {
    for (const n of names) {
      SAVED[n] = process.env[n];
      delete process.env[n];
    }
  }

  it('returns the FIRST absent env-var id in declared order', () => {
    clear('A_FIRST', 'B_SECOND', 'C_THIRD');
    const r = missingCredential(['A_FIRST', 'B_SECOND', 'C_THIRD']);
    assert.deepEqual(r, { missingPrerequisite: 'A_FIRST', kind: 'credential' });
  });

  it('skips present credentials and reports the first still-missing one', () => {
    clear('A_FIRST', 'B_SECOND', 'C_THIRD');
    process.env.A_FIRST = 'present';
    const r = missingCredential(['A_FIRST', 'B_SECOND', 'C_THIRD']);
    assert.deepEqual(r, { missingPrerequisite: 'B_SECOND', kind: 'credential' });
  });

  it('treats a blank/whitespace value as absent', () => {
    clear('A_FIRST');
    process.env.A_FIRST = '   ';
    const r = missingCredential(['A_FIRST']);
    assert.deepEqual(r, { missingPrerequisite: 'A_FIRST', kind: 'credential' });
  });

  it('returns null when every credential is present', () => {
    clear('A_FIRST', 'B_SECOND');
    process.env.A_FIRST = 'x';
    process.env.B_SECOND = 'y';
    assert.equal(missingCredential(['A_FIRST', 'B_SECOND']), null);
  });

  it('firstEnv returns the first defined+non-empty value or undefined', () => {
    clear('A_FIRST', 'B_SECOND');
    assert.equal(firstEnv(['A_FIRST', 'B_SECOND']), undefined);
    process.env.B_SECOND = 'fallback';
    assert.equal(firstEnv(['A_FIRST', 'B_SECOND']), 'fallback');
  });
});

describe('plugin probes — null or well-formed BlockedReason', () => {
  for (const id of EXPECTED_IDS) {
    it(`${id} probe returns null or a well-formed BlockedReason`, async () => {
      const result = await PLUGINS[id].probe();
      if (result === null) return; // backing service / account is present
      assert.equal(typeof result.missingPrerequisite, 'string');
      assert.ok(result.missingPrerequisite.length > 0, 'missing prerequisite id must be non-empty');
      assert.ok(VALID_KINDS.includes(result.kind), `kind must be one of ${VALID_KINDS.join('|')}, got ${result.kind}`);
    });
  }

  it('account-backed plugins report a credential prerequisite when their env is unset', async () => {
    const SAVED = {};
    const VENDOR_ENV = [
      'S3_BUCKET', 'S3_REGION', 'AWS_REGION', 'S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY',
      'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
      'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'SENDGRID_API_KEY',
      'STRIPE_API_KEY', 'STRIPE_TEST_KEY',
      'AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET',
    ];
    for (const k of VENDOR_ENV) { SAVED[k] = process.env[k]; delete process.env[k]; }
    try {
      for (const id of ['s3', 'r2', 'twilio', 'sendgrid', 'stripe', 'auth0']) {
        const r = await PLUGINS[id].probe();
        assert.ok(r !== null, `${id} should be BLOCKED with no credentials`);
        assert.equal(r.kind, 'credential', `${id} missing prerequisite should be a credential`);
        assert.ok(r.missingPrerequisite.length > 0);
      }
    } finally {
      for (const k of VENDOR_ENV) {
        if (SAVED[k] !== undefined) process.env[k] = SAVED[k];
        else delete process.env[k];
      }
    }
  });
});
