import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { createGateway } from "../gateway.js";
import type {
  Forwarder,
  GatewayConfig,
  GatewayRequest,
  GatewayResponse,
  Headers,
  Middleware,
} from "../types.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A fixed clock — the pipeline never needs to advance time under these tests. */
const fixedClock = (): number => 0;

// ── Property: middleware-ordering ─────────────────────────────────────────────

/**
 * Feature: gateway, Property: middleware-ordering
 *
 * N tagging middlewares each append their index to `ctx.state.order` on descent
 * and record `in:i` / `out:i` markers in a shared log. The terminal (the gateway
 * forward, driven by an injected forwarder) records `terminal`. For any N the
 * descent order must equal the registration order [0..N-1], the terminal must
 * observe exactly that ordering, and the ascent must be its exact reverse.
 */
test("Feature: gateway, Property: middleware-ordering — registration order in, reverse out, terminal once", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 8 }), async (n) => {
      const log: string[] = [];
      let terminalCount = 0;
      let seenAtTerminal: number[] = [];

      const forwarder: Forwarder = (): Promise<GatewayResponse> => {
        terminalCount++;
        log.push("terminal");
        return Promise.resolve({ status: 200, headers: {}, body: undefined });
      };

      const config: GatewayConfig = {
        routes: [{ pattern: "/", kind: "prefix", service: "svc" }],
        services: [{ name: "svc", targets: [{ id: "t", url: "http://t.local" }] }],
        clock: fixedClock,
        forwarder,
      };

      const gw = createGateway(config);

      // N tagging middlewares (registration order 0..n-1).
      for (let i = 0; i < n; i++) {
        const mw: Middleware = async (ctx, next) => {
          const order = ctx.state.order as number[] | undefined;
          const list = order ?? [];
          list.push(i);
          ctx.state.order = list;
          log.push(`in:${i}`);
          const res = await next();
          log.push(`out:${i}`);
          return res;
        };
        gw.use(mw);
      }

      // A capture middleware registered last snapshots what the terminal sees.
      gw.use(async (ctx, next) => {
        seenAtTerminal = ((ctx.state.order as number[] | undefined) ?? []).slice();
        return next();
      });

      const req: GatewayRequest = { method: "GET", url: "/", path: "/", headers: {} };
      const res = await gw.handle(req);
      assert.equal(res.status, 200);

      // Terminal runs exactly once.
      assert.equal(terminalCount, 1);

      // The terminal observes the tagging middlewares in registration order.
      assert.deepEqual(
        seenAtTerminal,
        Array.from({ length: n }, (_, i) => i),
      );

      // Descent in registration order, terminal, then ascent in reverse.
      const descent = Array.from({ length: n }, (_, i) => `in:${i}`);
      const ascent = Array.from({ length: n }, (_, i) => `out:${n - 1 - i}`);
      assert.deepEqual(log, [...descent, "terminal", ...ascent]);
      assert.equal(log.indexOf("terminal"), n);
    }),
    { numRuns: 100 },
  );
});

// ── Property: version-routing ─────────────────────────────────────────────────

/** Echo the target id so the caller can assert which version pool was hit. */
const versionEchoForwarder: Forwarder = (target): Promise<GatewayResponse> =>
  Promise.resolve({
    status: 200,
    headers: { "x-target": target.id },
    body: encoder.encode(target.id),
  });

type HeaderMode = "matching" | "unknown" | "absent";

const scenarioArb = fc.record({
  pathVersion: fc.constantFrom("v1", "v2"),
  headerMode: fc.constantFrom<HeaderMode>("matching", "unknown", "absent"),
  resource: fc.constantFrom("thing", "users/42", "a/b/c"),
});

/**
 * Feature: gateway, Property: version-routing
 *
 * With versioning over ["v1","v2"] (default "v1") and a route per version, a
 * request carrying a `/vX` path prefix routes deterministically to the vX
 * service pool, while the resolved `ctx.version` follows the `x-version` header:
 * a known value resolves to itself, and an unknown/absent value falls back to
 * the policy default.
 */
test("Feature: gateway, Property: version-routing — /vX prefix routes to vX, ctx.version follows the header or default", async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async (s) => {
      let capturedVersion: string | undefined;

      const config: GatewayConfig = {
        routes: [
          { pattern: "/v1", kind: "prefix", service: "svc-v1" },
          { pattern: "/v2", kind: "prefix", service: "svc-v2" },
        ],
        services: [
          { name: "svc-v1", targets: [{ id: "v1", url: "http://v1.local" }] },
          { name: "svc-v2", targets: [{ id: "v2", url: "http://v2.local" }] },
        ],
        versioning: { sources: ["x-version"], versions: ["v1", "v2"], default: "v1" },
        clock: fixedClock,
        forwarder: versionEchoForwarder,
      };

      const gw = createGateway(config);
      gw.use(async (ctx, next) => {
        capturedVersion = ctx.version;
        return next();
      });

      const headers: Record<string, string> = {};
      let expectedVersion: string;
      if (s.headerMode === "matching") {
        headers["x-version"] = s.pathVersion;
        expectedVersion = s.pathVersion;
      } else if (s.headerMode === "unknown") {
        headers["x-version"] = "v9";
        expectedVersion = "v1"; // default
      } else {
        expectedVersion = "v1"; // absent → default
      }

      const path = `/${s.pathVersion}/${s.resource}`;
      const req: GatewayRequest = {
        method: "GET",
        url: path,
        path,
        headers: headers as Headers,
      };

      const res = await gw.handle(req);

      // Routing follows the /vX path prefix deterministically.
      assert.equal(res.status, 200);
      assert.equal(res.headers["x-target"], s.pathVersion);
      assert.equal(decoder.decode(res.body), s.pathVersion);

      // ctx.version follows the header when known, else the policy default.
      assert.equal(capturedVersion, expectedVersion);
    }),
    { numRuns: 100 },
  );
});
