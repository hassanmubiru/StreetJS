// tests/validation-startup-secrecy-pbt.test.ts
// Property-based test for the runtime input Validator (Phase 1, Requirement 2).
//
// Feature: consumer-platform-security, Property 3 — Startup never emits
// secret/variable values.
// Validates: Requirements 2.8
//
// R2.8 requires that when a declared environment variable or CLI argument fails
// its Validation_Schema at startup, the Core_Package terminates startup with a
// non-zero exit code and emits the FAILING VARIABLE NAME without emitting the
// variable VALUE. Across arbitrary schemas, failing variables, and arbitrary
// (secret) values, this file proves, for both `validateEnv` and `validateArgv`:
//   1. Non-zero exit on failure (R2.8): startup terminates via process.exit with
//      a non-zero code.
//   2. Name emission (R2.8): every failing variable's NAME appears in the
//      stderr output.
//   3. Value secrecy (R2.8): NO declared variable's VALUE (failing or passing)
//      ever appears in the stderr output.
//
// Because `validateEnv`/`validateArgv` call `process.exit(1)` (which would tear
// down the test runner) and write to `process.stderr`, both are stubbed for the
// duration of each call: `process.exit` is replaced with a throwing sentinel so
// control returns to the test, and `process.stderr.write` is captured so the
// emitted bytes can be inspected. Kept in its own *-pbt.test.ts file per the repo
// convention.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { z } from 'zod';

import { validateEnv, validateArgv } from '../security/validation.js';

const NUM_RUNS = 100;

// ── Startup-call harness ──────────────────────────────────────────────────────
//
// Run a startup validator, intercepting process.exit (so the runner survives)
// and process.stderr.write (so we can inspect exactly what was emitted).

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface StartupOutcome {
  exited: boolean;
  exitCode: number | undefined;
  stderr: string;
}

function captureStartup(run: () => void): StartupOutcome {
  const originalWrite = process.stderr.write.bind(process.stderr);
  const originalExit = process.exit.bind(process);

  let stderr = '';
  let exited = false;
  let exitCode: number | undefined;

  (process.stderr as { write: unknown }).write = (chunk: unknown): boolean => {
    stderr += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  };
  (process as { exit: unknown }).exit = ((code?: number): never => {
    exited = true;
    exitCode = typeof code === 'number' ? code : 0;
    throw new ExitSignal(exitCode);
  }) as never;

  try {
    run();
  } catch (err) {
    if (!(err instanceof ExitSignal)) throw err;
  } finally {
    (process.stderr as { write: unknown }).write = originalWrite;
    (process as { exit: unknown }).exit = originalExit;
  }

  return { exited, exitCode, stderr };
}

// ── Generators ────────────────────────────────────────────────────────────────

// Env-style variable names, all UPPERCASE. Deliberately distinct from the
// lowercase "secret_" value prefix below so a value can never be a substring of
// a name (and vice versa).
const NAME_POOL = [
  'API_KEY',
  'DB_PASSWORD',
  'TOKEN',
  'PRIVATE_KEY',
  'SECRET_TOKEN',
  'ACCESS_KEY',
  'SESSION_SECRET',
  'JWT_SECRET',
] as const;

const ALNUM = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');

// A distinctive "secret" value. The lowercase "secret_" prefix guarantees the
// value is never a substring of the fixed stderr message text or of any
// UPPERCASE variable name, so a hit when scanning stderr is a genuine leak.
const secretValueArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ALNUM), { minLength: 6, maxLength: 24 })
  .map((cs) => `secret_${cs.join('')}`);

interface VarSpec {
  name: string;
  value: string;
}

interface Plan {
  /** Variables whose value violates the schema (must be reported by name). */
  failing: VarSpec[];
  /** Variables whose value conforms (must NOT be reported, value must stay secret). */
  passing: VarSpec[];
}

// A plan declares 1–4 failing variables and 0–4 passing variables over distinct
// names drawn from NAME_POOL, each carrying a distinctive secret value.
const planArb: fc.Arbitrary<Plan> = fc
  .uniqueArray(fc.constantFrom(...NAME_POOL), { minLength: 1, maxLength: NAME_POOL.length })
  .chain((names) =>
    fc
      .tuple(
        // At least one failing variable; the rest are passing.
        fc.integer({ min: 1, max: names.length }),
        fc.array(secretValueArb, { minLength: names.length, maxLength: names.length }),
      )
      .map(([failCount, values]) => {
        const failing: VarSpec[] = [];
        const passing: VarSpec[] = [];
        names.forEach((name, i) => {
          const value = values[i] as string;
          if (i < failCount) failing.push({ name, value });
          else passing.push({ name, value });
        });
        return { failing, passing } satisfies Plan;
      }),
  );

/**
 * Build a Zod object schema in which every failing variable must be a string of
 * length ≥ 50 (the secret values are ≤ ~31 chars, so they are guaranteed to
 * fail) and every passing variable is any string (so it conforms).
 */
function buildSchema(plan: Plan): z.ZodObject<Record<string, z.ZodString>> {
  const shape: Record<string, z.ZodString> = {};
  for (const v of plan.failing) shape[v.name] = z.string().min(50);
  for (const v of plan.passing) shape[v.name] = z.string();
  return z.object(shape);
}

function allValues(plan: Plan): string[] {
  return [...plan.failing, ...plan.passing].map((v) => v.value);
}

// ── Properties ────────────────────────────────────────────────────────────────

// Feature: consumer-platform-security, Property 3: Startup never emits secret/variable values
// Validates: Requirements 2.8
describe('Property 3: startup never emits secret/variable values', () => {
  it('validateEnv fails non-zero, emits every failing NAME, and leaks no VALUE (R2.8)', () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const schema = buildSchema(plan);
        const env: NodeJS.ProcessEnv = {};
        for (const v of [...plan.failing, ...plan.passing]) env[v.name] = v.value;

        const outcome = captureStartup(() => {
          validateEnv(schema, env);
        });

        // Non-zero exit on failure.
        assert.equal(outcome.exited, true);
        assert.notEqual(outcome.exitCode, 0);

        // Every failing variable NAME is emitted.
        for (const v of plan.failing) {
          assert.ok(
            outcome.stderr.includes(v.name),
            `expected stderr to include failing name ${v.name}`,
          );
        }

        // NO variable VALUE (failing or passing) is ever emitted.
        for (const value of allValues(plan)) {
          assert.equal(
            outcome.stderr.includes(value),
            false,
            `stderr must not contain the variable value ${value}`,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('validateArgv fails non-zero, emits every failing NAME, and leaks no VALUE (R2.8)', () => {
    fc.assert(
      fc.property(planArb, (plan) => {
        const schema = buildSchema(plan);
        // Encode every declared variable as a `--NAME=value` CLI token.
        const argv: string[] = [];
        for (const v of [...plan.failing, ...plan.passing]) {
          argv.push(`--${v.name}=${v.value}`);
        }

        const outcome = captureStartup(() => {
          validateArgv(schema, argv);
        });

        // Non-zero exit on failure.
        assert.equal(outcome.exited, true);
        assert.notEqual(outcome.exitCode, 0);

        // Every failing argument NAME is emitted.
        for (const v of plan.failing) {
          assert.ok(
            outcome.stderr.includes(v.name),
            `expected stderr to include failing name ${v.name}`,
          );
        }

        // NO argument VALUE (failing or passing) is ever emitted.
        for (const value of allValues(plan)) {
          assert.equal(
            outcome.stderr.includes(value),
            false,
            `stderr must not contain the argument value ${value}`,
          );
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
