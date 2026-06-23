// packages/cli/src/tests/marzpay-react-client-pbt.test.ts
// Property-based test for the scaffolded React MarzPay client lib (Task 16.2).
//
//   Property 11 (React client surfaces non-success status as an error): for all
//   responses from the application's MarzPay endpoints, the scaffolded React
//   client functions return the result on success and otherwise raise an error
//   that INCLUDES the returned status and yields no payment result.
//   **Validates: Requirements 8.2, 8.3, 8.4**
//
// The React client lib ships as a template string written by the
// `scaffoldReactMarzPay`/`renderReactMarzPayLib` methods of create.ts into a
// generated project's `web/src/lib/marzpay.ts` — it is NOT a top-level export.
// To exercise the REAL generated client we scaffold a react project into a temp
// dir (`street create <name> --frontend react`), read the emitted client source,
// transpile it (the type-only `@streetjs/plugin-marzpay` import is elided),
// neutralize the Vite-only `import.meta.env` reference, load it as a module, and
// inject a FAKE global `fetch` that returns a Response-like object with a
// generated HTTP status and body. Then we assert Property 11.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ts from 'typescript';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { CreateCommand } from '../commands/create.js';

// --- Structural mirrors of the scaffolded client contracts ------------------

interface PaymentRequest {
  amount: number;
  currency: string;
  country: string;
  reference: string;
  method: string;
}

/** The exported surface of the scaffolded `web/src/lib/marzpay.ts`. */
interface MarzPayLib {
  MarzPayError: new (status: number, message: string) => Error & { status: number };
  initializePayment(request: PaymentRequest): Promise<unknown>;
  verifyPayment(reference: string): Promise<unknown>;
}

/** A Response-like object sufficient for the client's `readJson` helper. */
interface FakeResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchFn = (input: unknown, init?: unknown) => Promise<FakeResponse>;

const TS_OPTS = {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
} as const;

/**
 * Scaffold a react project, read its generated MarzPay client lib, transpile it,
 * neutralize non-resolvable / non-Node references, and return the loaded module.
 *
 *   - `import type { ... } from '@streetjs/plugin-marzpay'` -> elided (type-only).
 *   - `import.meta.env`  -> `({})` so `({}).VITE_API_URL ?? ''` resolves to `''`
 *     (Vite injects `import.meta.env`; under Node it is absent and would throw).
 *
 * The client uses the global `fetch`, which the property body replaces per run.
 */
async function loadReactMarzPayLib(): Promise<{ lib: MarzPayLib; cleanup: () => void }> {
  const scaffoldDir = mkdtempSync(join(tmpdir(), 'street-react-scaffold-'));
  const loadDir = mkdtempSync(join(tmpdir(), 'street-react-load-'));
  const cleanup = (): void => {
    rmSync(scaffoldDir, { recursive: true, force: true });
    rmSync(loadDir, { recursive: true, force: true });
  };

  // Scaffold a real react project (silence its console output).
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    process.exitCode = 0;
    await new CreateCommand().execute({
      cwd: scaffoldDir,
      args: {
        command: 'create',
        positional: ['react-app'],
        flags: { 'no-lockfile': true, frontend: 'react' },
      },
    });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assert.equal(process.exitCode, 0, 'react scaffold should succeed');

  const libPath = join(scaffoldDir, 'react-app', 'web', 'src', 'lib', 'marzpay.ts');
  const source = readFileSync(libPath, 'utf8');

  const js = ts
    .transpileModule(source, TS_OPTS)
    .outputText
    // Neutralize the Vite-only env object (absent under Node, accessing a
    // property of `undefined` would throw at module-eval time).
    .replace(/import\.meta\.env/g, '({})');

  const file = join(loadDir, 'marzpay.mjs');
  writeFileSync(file, js, 'utf8');
  const mod = (await import(pathToFileURL(file).href)) as unknown as MarzPayLib;

  return { lib: mod, cleanup };
}

// --- Generators -------------------------------------------------------------

// fetch's `ok` is true exactly for 200–299; everything else is non-success.
const successStatusArb = fc.integer({ min: 200, max: 299 });
const nonSuccessStatusArb = fc.integer({ min: 300, max: 599 });

const requestArb: fc.Arbitrary<PaymentRequest> = fc.record({
  amount: fc.integer({ min: 1, max: 5_000_000 }),
  currency: fc.constantFrom('UGX', 'USD', 'KES', 'EUR'),
  country: fc.constantFrom('UG', 'KE', 'US'),
  reference: fc.stringMatching(/^ref_[a-z0-9]{1,12}$/),
  method: fc.constantFrom('card', 'mobile'),
});

const referenceArb = fc.stringMatching(/^ref_[a-z0-9]{1,32}$/);

// An arbitrary JSON-ish success body the endpoint "returns".
const bodyArb: fc.Arbitrary<Record<string, unknown>> = fc.record({
  reference: fc.string(),
  status: fc.constantFrom('pending', 'success', 'completed'),
  redirectUrl: fc.option(fc.webUrl(), { nil: undefined }),
});

/** Install a fake global fetch returning the given response; return a restorer. */
function withFakeFetch(status: number, body: unknown): () => void {
  const original = globalThis.fetch;
  const fake: FetchFn = async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  // The client only consumes ok/status/json from the Response.
  (globalThis as { fetch: unknown }).fetch = fake;
  return () => {
    (globalThis as { fetch: unknown }).fetch = original;
  };
}

// ---------------------------------------------------------------------------

void describe('React MarzPay client PBT', () => {
  let lib: MarzPayLib;
  let cleanup: () => void = () => {};

  before(async () => {
    const loaded = await loadReactMarzPayLib();
    lib = loaded.lib;
    cleanup = loaded.cleanup;
    assert.equal(typeof lib.initializePayment, 'function', 'initializePayment must be exported by the scaffold');
    assert.equal(typeof lib.verifyPayment, 'function', 'verifyPayment must be exported by the scaffold');
    assert.equal(typeof lib.MarzPayError, 'function', 'MarzPayError must be exported by the scaffold');
  });

  after(() => cleanup());

  // Feature: marzpay-integration, Property 11
  void it('Property 11: non-success status raises an error including the status and yields no result; success returns the parsed result — Validates: Requirements 8.2, 8.3, 8.4', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(), // true => exercise initializePayment, false => verifyPayment
        fc.boolean(), // true => success status, false => non-success status
        successStatusArb,
        nonSuccessStatusArb,
        requestArb,
        referenceArb,
        bodyArb,
        async (useInitialize, isSuccess, okStatus, badStatus, request, reference, body) => {
          const status = isSuccess ? okStatus : badStatus;
          const restore = withFakeFetch(status, body);
          try {
            const call = (): Promise<unknown> =>
              useInitialize ? lib.initializePayment(request) : lib.verifyPayment(reference);

            if (isSuccess) {
              // Success (2xx): the client returns the parsed result.
              const result = await call();
              assert.deepEqual(result, body, 'a success response must return the parsed result body');
            } else {
              // Non-success: the client raises an error that INCLUDES the status
              // and returns no payment result.
              const NO_RESULT = Symbol('no-result');
              let raised = false;
              let returned: unknown = NO_RESULT;
              try {
                returned = await call();
              } catch (err) {
                raised = true;
                assert.ok(err instanceof Error, 'a non-success response must raise an Error');
                const e = err as Error & { status?: number };
                assert.ok(
                  e.message.includes(String(status)),
                  `the error message must include the returned status (${status}); got: ${e.message}`,
                );
                assert.equal(e.status, status, 'the error must carry the returned status in its `status` field');
                assert.ok(e instanceof lib.MarzPayError, 'the error must be a MarzPayError');
              }
              assert.ok(raised, `a non-success status (${status}) must raise an error, not return a result`);
              assert.equal(returned, NO_RESULT, 'no payment result may be produced on a non-success response');
            }
          } finally {
            restore();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
