// Property-based test for MarzPay plugin configuration validation.
// Pure/offline — no network. Run: npm test -w packages/plugin-marzpay
//
// Feature: marzpay-integration, Property 1: Configuration validation accepts
// exactly the valid configs — for all configuration inputs,
// validateMarzPayConfig returns a normalized config when apiKey and secretKey
// are non-empty after trimming and environment (if present) is 'sandbox' or
// 'production', and otherwise throws a PluginError naming the offending field;
// a thrown config never yields an injected client.
//
// Validates: Requirements 2.2, 2.3, 2.4, 2.7

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { PluginError } from 'streetjs';

import { validateMarzPayConfig } from '../dist/index.js';

const DEFAULT_STATE_KEY = 'marzpay';
const DEFAULT_TIMEOUT_MS = 30_000;

// ── Generators ───────────────────────────────────────────────────────────────
// A credential string that is non-empty after trimming (always valid). Appending
// a non-whitespace character guarantees a non-empty trim while still allowing
// surrounding whitespace, which the validator accepts and stores verbatim.
const validCredential = fc
  .string()
  .map((s) => `${s}k`)
  .map((value) => ({ value, valid: true }));

// Credential values rejected by the validator: empty/whitespace-only strings and
// non-string values (covering the "missing/empty/whitespace-only" cases).
const invalidCredential = fc
  .oneof(
    fc.constantFrom('', ' ', '   ', '\t', '\n', '\r\n', ' \t '),
    fc.constantFrom(undefined, null, 0, 42, true, false),
    fc.constant({}),
    fc.constant([]),
  )
  .map((value) => ({ value, valid: false }));

const credentialArb = fc.oneof(validCredential, invalidCredential);

// environment: undefined (use default) or an explicit verified value are valid;
// anything else is rejected naming "environment".
const validEnvironment = fc
  .constantFrom(undefined, 'sandbox', 'production')
  .map((value) => ({ value, valid: true, present: value !== undefined }));

const invalidEnvironment = fc
  .oneof(
    fc.constantFrom('prod', 'live', 'SANDBOX', 'Production', 'test', '', ' '),
    fc.string().filter((s) => s !== 'sandbox' && s !== 'production'),
    fc.constantFrom(null, 0, 1, true),
  )
  .map((value) => ({ value, valid: false, present: true }));

const environmentArb = fc.oneof(validEnvironment, invalidEnvironment);

// stateKey / timeoutMs are kept valid here so the only sources of invalidity are
// apiKey, secretKey, and environment (the fields Property 1 governs). Each may be
// absent (exercising defaults) or a valid explicit value.
const stateKeyArb = fc.option(
  fc.string().map((s) => `${s}s`),
  { nil: undefined },
);
const timeoutArb = fc.option(
  fc.integer({ min: 1, max: 600_000 }),
  { nil: undefined },
);

const configArb = fc.record({
  apiKey: credentialArb,
  secretKey: credentialArb,
  environment: environmentArb,
  stateKey: stateKeyArb,
  timeoutMs: timeoutArb,
});

// Build the raw input object the validator receives, and the reference oracle
// describing the expected outcome.
function buildInput(spec) {
  const input = {
    apiKey: spec.apiKey.value,
    secretKey: spec.secretKey.value,
  };
  if (spec.environment.present) input.environment = spec.environment.value;
  if (spec.stateKey !== undefined) input.stateKey = spec.stateKey;
  if (spec.timeoutMs !== undefined) input.timeoutMs = spec.timeoutMs;
  return input;
}

// The validator checks fields in order: apiKey, secretKey, environment.
function offendingField(spec) {
  if (!spec.apiKey.valid) return 'apiKey';
  if (!spec.secretKey.valid) return 'secretKey';
  if (spec.environment.present && !spec.environment.valid) return 'environment';
  return null;
}

describe('Property 1: configuration validation accepts exactly the valid configs', () => {
  it('accepts iff apiKey/secretKey non-empty after trim and environment valid; else throws naming the field', () => {
    fc.assert(
      fc.property(configArb, (spec) => {
        const input = buildInput(spec);
        const field = offendingField(spec);

        if (field === null) {
          // Valid config → returns a normalized config with defaults applied.
          const cfg = validateMarzPayConfig(input);
          assert.equal(cfg.apiKey, spec.apiKey.value);
          assert.equal(cfg.secretKey, spec.secretKey.value);
          assert.equal(
            cfg.environment,
            spec.environment.present ? spec.environment.value : 'sandbox',
          );
          assert.equal(
            cfg.stateKey,
            spec.stateKey !== undefined ? spec.stateKey : DEFAULT_STATE_KEY,
          );
          assert.equal(
            cfg.timeoutMs,
            spec.timeoutMs !== undefined ? spec.timeoutMs : DEFAULT_TIMEOUT_MS,
          );
        } else {
          // Invalid config → throws a PluginError naming the offending field.
          assert.throws(
            () => validateMarzPayConfig(input),
            (err) =>
              err instanceof PluginError && err.message.includes(`"${field}"`),
            `expected PluginError naming "${field}" for input ${JSON.stringify(input)}`,
          );
        }
      }),
      { numRuns: 300 },
    );
  });
});
