// packages/cli/src/tests/marzpay-htmx-failure.test.ts
// Unit test for the scaffolded HTMX MarzPay controller failure fragment (Task 15.2).
//
// Requirement 7.5: IF the MarzPay_Plugin `initializePayment` operation invoked
// from the scaffolded HTMX controller raises an error OR returns a non-success
// result, THEN the scaffolded HTMX controller SHALL return a server-rendered
// fragment indicating that payment initialization failed and SHALL NOT return a
// redirect fragment.
//
// Validates: Requirements 7.5
//
// The HTMX MarzPay controller is written by the `scaffoldHtmxMarzPay` method of
// create.ts as a template string into a generated project's
// `src/controllers/marzpay.controller.ts` — it is NOT a top-level export. To
// exercise the REAL generated controller we scaffold an htmx project into a temp
// dir (`street create <name> --frontend htmx`), read the emitted controller
// source, transpile it (enabling decorators), neutralize its non-resolvable
// imports (`reflect-metadata`, the `streetjs` decorators, and the type-only
// `@streetjs/plugin-marzpay`), load it as a module, then drive the checkout
// handler with a fake StreetContext that captures which fragment is rendered and
// whether an HX-Redirect was set.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { CreateCommand } from '../commands/create.js';

// --- Structural mirrors of the scaffolded controller contracts ---------------

interface PaymentInitResult {
  reference: string;
  redirectUrl?: string;
  status: string;
}

interface FakeMarzPayClient {
  initializePayment(args: Record<string, unknown>): Promise<PaymentInitResult>;
}

/** Constructor type for the scaffolded MarzPayViewsController. */
type ControllerCtor = new () => {
  // @Post('/checkout') handler — initializePayment is reached through here.
  initialize(ctx: FakeCtx): Promise<void>;
};

/** A render captured from ctx.htmx.view(name, data, status?). */
interface Rendered {
  name: string;
  data: Record<string, unknown>;
  status?: number;
}

/** A minimal StreetContext stand-in capturing renders + HX-Redirect. */
interface FakeCtx {
  state: Record<string, unknown>;
  body: Record<string, unknown>;
  htmx: {
    view(name: string, data?: Record<string, unknown>, status?: number): FakeCtx['htmx'];
    hx(opts: { redirect?: string } & Record<string, unknown>): FakeCtx['htmx'];
    partial(): FakeCtx['htmx'];
    engine: { partial: () => string };
  };
}

interface Harness {
  ctx: FakeCtx;
  rendered: Rendered[];
  hxRedirect(): string | null;
}

/** Build a fake context wired to the given client + request body. */
function makeHarness(client: FakeMarzPayClient | undefined, body: Record<string, unknown>): Harness {
  const rendered: Rendered[] = [];
  let redirect: string | null = null;

  const htmx: FakeCtx['htmx'] = {
    view(name, data = {}, status) {
      rendered.push({ name, data, status });
      return htmx;
    },
    hx(opts) {
      if (typeof opts.redirect === 'string') redirect = opts.redirect;
      return htmx;
    },
    partial() {
      return htmx;
    },
    engine: { partial: () => '' },
  };

  const ctx: FakeCtx = {
    state: client === undefined ? {} : { marzpay: client },
    body,
    htmx,
  };

  return { ctx, rendered, hxRedirect: () => redirect };
}

// --- Scaffold + load the REAL generated controller ---------------------------

const TS_OPTS = {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    // The controller uses @Controller/@Get/@Post class+method decorators.
    experimentalDecorators: true,
    // No reflect-metadata at runtime (the import is neutralized below), so do
    // NOT emit metadata that would reference Reflect.metadata.
    emitDecoratorMetadata: false,
  },
} as const;

/**
 * Scaffold an htmx project, read its generated MarzPay controller, transpile it,
 * neutralize non-resolvable imports, and return the loaded controller class.
 *
 *   - `import 'reflect-metadata';`             -> removed (side-effect import).
 *   - `import { Controller, Get, Post } ...`   -> local no-op decorator stubs.
 *   - `import type { ... } from '@streetjs/...'`-> elided by transpile (type-only).
 */
async function loadHtmxController(): Promise<{ Controller: ControllerCtor; cleanup: () => void }> {
  const scaffoldDir = mkdtempSync(join(tmpdir(), 'street-htmx-scaffold-'));
  const loadDir = mkdtempSync(join(tmpdir(), 'street-htmx-load-'));
  const cleanup = (): void => {
    rmSync(scaffoldDir, { recursive: true, force: true });
    rmSync(loadDir, { recursive: true, force: true });
  };

  // Scaffold a real htmx project (silence its console output).
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
        positional: ['hx-app'],
        flags: { 'no-lockfile': true, frontend: 'htmx' },
      },
    });
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  assert.equal(process.exitCode, 0, 'htmx scaffold should succeed');

  const controllerPath = join(scaffoldDir, 'hx-app', 'src', 'controllers', 'marzpay.controller.ts');
  const source = readFileSync(controllerPath, 'utf8');

  const js = ts
    .transpileModule(source, TS_OPTS)
    .outputText
    // Drop the reflect-metadata side-effect import (no decorator metadata emitted).
    .replace(/import\s*['"]reflect-metadata['"];?/, '')
    // Replace the streetjs decorator import with local no-op decorator factories.
    .replace(
      /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
      'const Controller = () => (t) => t; const Get = () => () => {}; const Post = () => () => {};',
    );

  const file = join(loadDir, 'marzpay.controller.mjs');
  writeFileSync(file, js, 'utf8');
  const mod = await import(pathToFileURL(file).href);

  return { Controller: mod.MarzPayViewsController as ControllerCtor, cleanup };
}

// --- The standard request body the checkout handler reads --------------------

const CHECKOUT_BODY = { amount: '10000', currency: 'UGX', country: 'UG', reference: 'ref-1' } as const;

// ---------------------------------------------------------------------------

void describe('HTMX MarzPay controller — failure fragment (Req 7.5)', () => {
  let Controller: ControllerCtor;
  let cleanup: () => void = () => {};

  before(async () => {
    const loaded = await loadHtmxController();
    Controller = loaded.Controller;
    cleanup = loaded.cleanup;
    assert.equal(typeof Controller, 'function', 'MarzPayViewsController must be importable from the scaffold');
  });

  after(() => cleanup());

  void it('renders the failure fragment (no redirect, no HX-Redirect) when initializePayment THROWS', async () => {
    const client: FakeMarzPayClient = {
      initializePayment: async () => {
        throw new Error('boom: marzpay network error');
      },
    };
    const h = makeHarness(client, { ...CHECKOUT_BODY });

    await new Controller().initialize(h.ctx);

    const names = h.rendered.map((r) => r.name);
    assert.ok(names.includes('marzpay/failure'), 'a failure fragment must be rendered on a thrown error');
    assert.ok(!names.includes('marzpay/redirect'), 'the redirect fragment must NOT be rendered on a thrown error');
    assert.equal(h.hxRedirect(), null, 'no HX-Redirect may be set on the failure path');
  });

  void it('renders the failure fragment (no redirect) when initializePayment returns status "failed"', async () => {
    const client: FakeMarzPayClient = {
      // Non-success result: terminal failed status, no redirectUrl.
      initializePayment: async () => ({ reference: 'ref-1', status: 'failed' }),
    };
    const h = makeHarness(client, { ...CHECKOUT_BODY });

    await new Controller().initialize(h.ctx);

    const names = h.rendered.map((r) => r.name);
    assert.ok(names.includes('marzpay/failure'), 'a failure fragment must be rendered for a non-success result');
    assert.ok(!names.includes('marzpay/redirect'), 'the redirect fragment must NOT be rendered for a non-success result');
    assert.equal(h.hxRedirect(), null, 'no HX-Redirect may be set for a non-success result');
  });

  void it('renders the failure fragment (no redirect) when initializePayment returns status "cancelled"', async () => {
    const client: FakeMarzPayClient = {
      initializePayment: async () => ({ reference: 'ref-1', status: 'cancelled' }),
    };
    const h = makeHarness(client, { ...CHECKOUT_BODY });

    await new Controller().initialize(h.ctx);

    const names = h.rendered.map((r) => r.name);
    assert.ok(names.includes('marzpay/failure'), 'a failure fragment must be rendered for a cancelled result');
    assert.ok(!names.includes('marzpay/redirect'), 'the redirect fragment must NOT be rendered for a cancelled result');
    assert.equal(h.hxRedirect(), null, 'no HX-Redirect may be set for a cancelled result');
  });

  // Positive control: proves the failure assertions above are meaningful — the
  // SAME handler DOES render the redirect fragment on a verified success.
  void it('positive control: renders the redirect fragment (+ HX-Redirect) on a success with a redirectUrl', async () => {
    const client: FakeMarzPayClient = {
      initializePayment: async () => ({
        reference: 'ref-1',
        redirectUrl: 'https://pay.example/redirect',
        status: 'pending',
      }),
    };
    const h = makeHarness(client, { ...CHECKOUT_BODY });

    await new Controller().initialize(h.ctx);

    const names = h.rendered.map((r) => r.name);
    assert.ok(names.includes('marzpay/redirect'), 'a successful card init must render the redirect fragment');
    assert.ok(!names.includes('marzpay/failure'), 'the failure fragment must NOT be rendered on success');
    assert.equal(h.hxRedirect(), 'https://pay.example/redirect', 'HX-Redirect must be set to the redirect URL on success');
  });
});
