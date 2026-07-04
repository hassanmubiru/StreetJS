import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import * as gateway from "../index.js";
import * as testing from "../testing/index.js";
import * as core from "streetjs";

/**
 * Backward-compatibility / regression guards.
 *
 * These assert the additive contract of @streetjs/gateway:
 *  1. The core `streetjs` public surface this package relies on is unchanged.
 *  2. The gateway public export surface is stable and complete.
 *  3. The base entry pulls in NO cloud SDK and NO sibling pillar package —
 *     integration with the pillars is optional/structural, not a hard import.
 */

describe("regression: streetjs core surface is intact (not modified)", () => {
  it("still exports the core primitives the gateway builds on", () => {
    for (const name of ["systemClock", "MetricsRegistry", "PluginModule", "Command"]) {
      assert.ok(name in core, `expected streetjs to still export ${name}`);
    }
    assert.equal(typeof core.systemClock, "function");
  });
});

describe("regression: gateway public export surface is stable", () => {
  it("exposes the documented top-level entrypoints", () => {
    const required = [
      "createGateway",
      "GatewayError",
      "RouteNotFoundError",
      "NoHealthyUpstreamError",
      "CircuitOpenError",
      "UpstreamTimeoutError",
      "RateLimitExceededError",
      "UnauthenticatedError",
      "ForbiddenError",
      "RequestValidationError",
      "PayloadTooLargeError",
      "GatewayConfigError",
      "Router",
      "createRouter",
      "RoundRobinBalancer",
      "LeastConnectionsBalancer",
      "RandomBalancer",
      "WeightedRoundRobinBalancer",
      "createBalancer",
      "HealthRegistry",
      "CircuitBreaker",
      "RateLimiter",
      "authenticate",
      "authorize",
      "RequestLogger",
      "registerGatewayObservability",
      "GatewayPlugin",
      "GatewayCommands",
      "httpForwarder",
      "proxyWebSocketUpgrade",
      "compose",
      "runPipeline",
      "GATEWAY_PACKAGE_NAME",
      "GATEWAY_FRAMEWORK_VERSION",
    ];
    for (const name of required) {
      assert.ok(name in gateway, `missing public export: ${name}`);
    }
    assert.equal(gateway.GATEWAY_PACKAGE_NAME, "@streetjs/gateway");
  });

  it("exposes the testing doubles on the ./testing subpath", () => {
    assert.equal(typeof testing.FakeGateway, "function");
    assert.equal(typeof testing.GatewayHarness, "function");
    assert.equal(typeof testing.FakeBackend, "function");
  });
});

describe("regression: base entry has no hard pillar / cloud-SDK imports", () => {
  it("declares pillar packages as OPTIONAL peer dependencies only", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/tests/regression.test.js → package.json at package root.
    const pkgPath = resolve(here, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };

    // The ONLY runtime dependency is streetjs.
    assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ["streetjs"]);

    // Each pillar is a peer dep marked optional.
    for (const pillar of [
      "@streetjs/realtime",
      "@streetjs/queue",
      "@streetjs/events",
      "@streetjs/storage",
    ]) {
      assert.ok(pkg.peerDependencies?.[pillar], `${pillar} should be a peer dependency`);
      assert.equal(
        pkg.peerDependenciesMeta?.[pillar]?.optional,
        true,
        `${pillar} peer dependency must be optional`,
      );
    }
  });

  it("does not statically import any @streetjs/* pillar in compiled source", () => {
    // Walk the compiled base surface (excluding tests/examples) and assert none
    // of it `import`s a sibling pillar package — integration is structural.
    const here = dirname(fileURLToPath(import.meta.url));
    const distRoot = resolve(here, "..");
    const files = [
      "index.js",
      "gateway.js",
      "proxy.js",
      "plugin.js",
      "observability.js",
      "health.js",
    ];
    for (const rel of files) {
      const src = readFileSync(resolve(distRoot, rel), "utf8");
      assert.doesNotMatch(
        src,
        /from\s+["']@streetjs\/(realtime|queue|events|storage)["']/,
        `${rel} must not statically import a pillar package`,
      );
    }
  });
});
