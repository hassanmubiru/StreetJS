// Unit tests for the @streetjs/gateway GatewayPlugin load/unload lifecycle.
//
// Covers:
//   - the `gateway` accessor is `undefined` before `onLoad`, exposes a usable
//     live Gateway after `onLoad` (a trivial request driven through it with an
//     injected forwarder returns the canned upstream response), and is
//     `undefined` again after `onUnload`, so the plugin exposes the gateway on
//     load and releases it on unload without modifying any existing public API.
//   - declarative `wireMiddleware`: every wiring fn is invoked with the live
//     gateway on load.
//   - `onLoad` is idempotent per load: a second `onLoad` without an intervening
//     `onUnload` does not reconstruct the gateway, and `onUnload` on a
//     never-loaded plugin is a safe no-op.
//
// The `SandboxedApp` handed to the hooks is a minimal fake — `{ use, on }` —
// matching the real sandbox surface (it exposes only `use`/`on`), so no
// application/host machinery is needed. An injected fake `forwarder` returns a
// canned response, so the tests need no network.

import test from "node:test";
import assert from "node:assert/strict";

import type { Clock } from "streetjs";
import type { SandboxedApp } from "streetjs";

import { GatewayPlugin, type GatewayPluginOptions } from "../plugin.js";
import type { Gateway } from "../gateway.js";
import type {
  Forwarder,
  GatewayRequest,
  GatewayResponse,
  RouteConfig,
  ServiceConfig,
} from "../types.js";

// ── Test harness ─────────────────────────────────────────────────────────────────

/** A deterministic, injected fake Clock fixed at a constant instant. */
const CLOCK: Clock = () => 1_000;

/**
 * A minimal fake of the `SandboxedApp` the plugin host hands to a plugin. The
 * real sandbox exposes only `use(middleware)` and `on(event, handler)`; the
 * gateway plugin touches neither in `onLoad`/`onUnload` (it resolves its
 * configuration from the plugin options), so no-op implementations suffice.
 */
function fakeApp(): SandboxedApp {
  return { use() {}, on() {} } as unknown as SandboxedApp;
}

const CANNED_BODY = new TextEncoder().encode("hello from upstream");

/**
 * An injected forwarder that returns a canned upstream response without any
 * network I/O, so a request driven through the gateway resolves deterministically.
 */
const CANNED_FORWARDER: Forwarder = async () => ({
  status: 200,
  headers: { "content-type": "text/plain" },
  body: CANNED_BODY,
});

const ROUTES: readonly RouteConfig[] = [
  { pattern: "/api/*", kind: "prefix", service: "backend" },
];

const SERVICES: readonly ServiceConfig[] = [
  { name: "backend", targets: [{ id: "t1", url: "http://127.0.0.1:9" }] },
];

function baseOptions(extra: Partial<GatewayPluginOptions> = {}): GatewayPluginOptions {
  return {
    routes: ROUTES,
    services: SERVICES,
    clock: CLOCK,
    forwarder: CANNED_FORWARDER,
    ...extra,
  };
}

function trivialRequest(): GatewayRequest {
  return {
    method: "GET",
    url: "/api/thing",
    path: "/api/thing",
    headers: {},
  };
}

// ── 1. Gateway exposed on load, released on unload ─────────────────────────────────

test("the gateway accessor exposes a usable gateway on load and is released on unload", async () => {
  const plugin = new GatewayPlugin(baseOptions());
  const app = fakeApp();

  // Before load the accessor is undefined — no gateway exists yet. Read into a
  // local so the equality check narrows the local, not the `gateway` getter.
  const beforeLoad: Gateway | undefined = plugin.gateway;
  assert.ok(beforeLoad === undefined, "the gateway is undefined before onLoad");

  await plugin.onLoad(app);

  // After load the accessor returns a live, usable gateway.
  const gw: Gateway | undefined = plugin.gateway;
  assert.ok(gw, "the gateway is exposed after onLoad");

  // The exposed gateway actually works end-to-end: drive a trivial request
  // through it and get the canned upstream response back.
  const res: GatewayResponse = await gw.handle(trivialRequest());
  assert.equal(res.status, 200, "the exposed gateway forwards the request to the injected forwarder");
  assert.deepEqual(res.body, CANNED_BODY, "the canned upstream body is returned to the client");

  await plugin.onUnload(app);

  // After unload the accessor is undefined again — resources are released.
  assert.ok(plugin.gateway === undefined, "the gateway is released (undefined) after onUnload");
});

// ── 2. wireMiddleware invocation ───────────────────────────────────────────────────

test("each wireMiddleware fn is invoked with the live gateway on load", async () => {
  const wireCalls: Gateway[] = [];

  const plugin = new GatewayPlugin(
    baseOptions({
      wireMiddleware: [
        (gw) => {
          wireCalls.push(gw);
          // Exercise the live surface: registering a middleware must not throw.
          gw.use(async (_ctx, next) => next());
        },
      ],
    }),
  );
  const app = fakeApp();

  await plugin.onLoad(app);

  // The wiring fn ran exactly once, handed the very gateway the plugin exposes.
  assert.equal(wireCalls.length, 1, "the wireMiddleware fn is invoked once on load");
  assert.equal(wireCalls[0], plugin.gateway, "the wireMiddleware fn receives the live gateway");

  await plugin.onUnload(app);
});

// ── 3. Idempotent load and safe never-loaded unload ────────────────────────────────

test("a second onLoad without an intervening onUnload reuses the gateway and does not re-wire", async () => {
  let wireCalls = 0;
  const plugin = new GatewayPlugin(
    baseOptions({
      wireMiddleware: [
        () => {
          wireCalls += 1;
        },
      ],
    }),
  );
  const app = fakeApp();

  await plugin.onLoad(app);
  const firstGateway = plugin.gateway;

  await plugin.onLoad(app);
  // The same gateway is retained and the wiring did not run a second time.
  assert.equal(plugin.gateway, firstGateway, "a repeated onLoad reuses the constructed gateway");
  assert.equal(wireCalls, 1, "the middleware wiring is not re-applied on a repeated onLoad");

  await plugin.onUnload(app);
});

test("onUnload on a never-loaded plugin is a safe no-op", async () => {
  const plugin = new GatewayPlugin(baseOptions());

  // No gateway was ever constructed; unload must not throw and the accessor
  // stays undefined.
  await plugin.onUnload(fakeApp());
  assert.ok(plugin.gateway === undefined, "the accessor stays undefined after a no-op unload");
});
