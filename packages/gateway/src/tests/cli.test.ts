// src/tests/cli.test.ts
// CLI tests for @streetjs/gateway.
//
// Covers three concerns, mirroring the sibling `packages/workflow` cli test:
//   (1) Command registration — the four gateway commands (`make:gateway-route`,
//       `make:proxy`, `gateway:routes`, `gateway:health`) are exposed through the
//       `@Command` metadata and can be registered on the core `CliKernel` without
//       collision.
//   (2) Compile-clean scaffold output — the pure generators (driven both directly
//       and through the make:* commands) emit typed TypeScript that imports only
//       public `@streetjs/gateway` symbols and declares the expected exports.
//   (3) Operational commands — `gateway:routes` prints each route as
//       pattern → service, and `gateway:health` prints healthy/unhealthy counts
//       plus per-target state. Both drive a `GatewayCommands` built with an
//       injected gateway/config.
//
// Uses the Node.js built-in test runner (node:test), executed via
// `node --test dist/tests/cli.test.js`.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliKernel, getCommandMeta } from "streetjs";
import type { ParsedArgs } from "streetjs";

import { GatewayCommands } from "../cli/commands.js";
import { generateGatewayRoute, generateProxy } from "../cli/generators.js";
import { createGateway } from "../gateway.js";
import type { Gateway } from "../gateway.js";
import type { GatewayConfig } from "../types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** The four commands the Gateway_CLI must provide. */
const EXPECTED_COMMANDS = [
  "make:gateway-route",
  "make:proxy",
  "gateway:routes",
  "gateway:health",
] as const;

/** Build a ParsedArgs object matching the shape streetjs' parseArgv produces. */
function parsedArgs(
  { command = null, positional = [], flags = {} }: Partial<ParsedArgs> = {},
): ParsedArgs {
  return { command, positional, flags };
}

/**
 * Run `fn` while capturing everything written to console.log/console.error and
 * with process.exitCode reset, restoring all three afterwards. Returns the
 * captured output plus the exitCode observed after `fn` completes.
 */
async function captureRun(
  fn: () => void | Promise<void>,
): Promise<{ logs: string[]; errors: string[]; exitCode: number | string | undefined }> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const logs: string[] = [];
  const errors: string[] = [];
  console.log = (...args: unknown[]): void => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]): void => {
    errors.push(args.map(String).join(" "));
  };
  process.exitCode = undefined;
  try {
    await fn();
    return { logs, errors, exitCode: process.exitCode };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
}

/**
 * Build a `GatewayCommands` over a freshly created gateway with two "users"
 * targets, one of which is marked unhealthy so `stats()` reports a 1/1 split and
 * per-target state exercises both `unknown` and `unhealthy`.
 */
function makeCommands(): { commands: GatewayCommands; gateway: Gateway; config: GatewayConfig } {
  const config: GatewayConfig = {
    services: [
      {
        name: "users",
        targets: [
          { id: "users-1", url: "http://127.0.0.1:8081" },
          { id: "users-2", url: "http://127.0.0.1:8082" },
        ],
        strategy: "round-robin",
      },
    ],
    routes: [{ id: "users", pattern: "/users/*", kind: "prefix", service: "users" }],
  };
  const gateway = createGateway(config);
  // Mark one target unhealthy so the health snapshot is a 1/1 split.
  gateway.health.setState("users-2", "unhealthy");
  return { commands: new GatewayCommands(gateway, config), gateway, config };
}

// ── (1) Command registration ────────────────────────────────────────────────────

test("GatewayCommands exposes the four gateway commands via @Command metadata", () => {
  const meta = getCommandMeta(GatewayCommands);
  const names = meta.map((cmd) => cmd.name);

  for (const expected of EXPECTED_COMMANDS) {
    assert.ok(names.includes(expected), `missing @Command "${expected}" (found: ${names.join(", ")})`);
  }
  // Every registered command must carry a non-empty description and a handler.
  for (const cmd of meta) {
    assert.equal(typeof cmd.handlerMethod, "string");
    assert.ok(cmd.handlerMethod.length > 0, `command "${cmd.name}" has no handler method`);
    assert.ok(cmd.description.length > 0, `command "${cmd.name}" has no description`);
  }
});

test("GatewayCommands registers on the core CliKernel without collision", () => {
  const kernel = new CliKernel({ appName: "street" });
  assert.doesNotThrow(() => kernel.register(GatewayCommands));
});

// ── (2) Compile-clean scaffold output ────────────────────────────────────────────

test("generateGatewayRoute emits a typed RouteConfig importing only public @streetjs/gateway symbols", () => {
  const result = generateGatewayRoute("UsersApi");

  // Path derives from the PascalCase name under the default route dir
  // (`join` normalizes the leading "./" away).
  assert.ok(result.path.endsWith("routes/UsersApiRoute.ts"), `unexpected path: ${result.path}`);

  const contents = result.contents;

  // Imports ONLY the public package entry point (type-only, no relative imports).
  assert.match(contents, /import type \{ RouteConfig \} from "@streetjs\/gateway";/);
  assert.ok(
    !/from "\.\.?\//.test(contents),
    "scaffold must not import from relative/internal paths",
  );

  // Declares the expected typed export.
  assert.match(contents, /export const usersApiRoute: RouteConfig = \{/);
  assert.match(contents, /service: "users-api",/);
  assert.match(contents, /pattern: "\/users-api\/\*",/);
});

test("generateProxy emits a createGateway wiring importing only public @streetjs/gateway symbols", () => {
  const result = generateProxy("Edge");

  assert.ok(result.path.endsWith("gateways/EdgeGateway.ts"), `unexpected path: ${result.path}`);

  const contents = result.contents;

  // Imports the public value + types only (no relative/internal imports).
  assert.match(contents, /import \{ createGateway \} from "@streetjs\/gateway";/);
  assert.match(contents, /import type \{ Gateway, GatewayConfig \} from "@streetjs\/gateway";/);
  assert.ok(
    !/from "\.\.?\//.test(contents),
    "scaffold must not import from relative/internal paths",
  );

  // Declares the expected typed config const and gateway factory.
  assert.match(contents, /export const edgeGatewayConfig: GatewayConfig = \{/);
  assert.match(contents, /export function createEdgeGateway\(\): Gateway \{/);
  assert.match(contents, /return createGateway\(edgeGatewayConfig\);/);
});

test("make:gateway-route validates the name and sets exit code 1 without writing", async () => {
  const commands = new GatewayCommands();
  const { errors, exitCode } = await captureRun(() =>
    commands.makeGatewayRoute(parsedArgs({ command: "make:gateway-route", positional: ["bad-name"] })),
  );
  assert.equal(exitCode, 1);
  assert.match(errors.join("\n"), /Invalid route name/);
});

test("make:gateway-route writes the generated scaffold under --dir and refuses to overwrite", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-cli-route-"));
  try {
    const commands = new GatewayCommands();
    const argv = parsedArgs({
      command: "make:gateway-route",
      positional: ["UsersApi"],
      flags: { dir },
    });

    const first = await captureRun(() => commands.makeGatewayRoute(argv));
    assert.notEqual(first.exitCode, 1, "the first write succeeds");

    const written = join(dir, "UsersApiRoute.ts");
    assert.ok(existsSync(written), "the scaffold file was written");
    const onDisk = readFileSync(written, "utf8");
    assert.match(onDisk, /import type \{ RouteConfig \} from "@streetjs\/gateway";/);
    assert.match(onDisk, /export const usersApiRoute: RouteConfig = \{/);

    // A second write to the same path must refuse to overwrite (exit code 1).
    const second = await captureRun(() => commands.makeGatewayRoute(argv));
    assert.equal(second.exitCode, 1);
    assert.match(second.errors.join("\n"), /Refusing to overwrite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("make:proxy writes the generated gateway scaffold under --dir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-cli-proxy-"));
  try {
    const commands = new GatewayCommands();
    const { logs, exitCode } = await captureRun(() =>
      commands.makeProxy(parsedArgs({ command: "make:proxy", positional: ["Edge"], flags: { dir } })),
    );
    assert.notEqual(exitCode, 1);
    assert.match(logs.join("\n"), /Generated proxy module/);

    const written = join(dir, "EdgeGateway.ts");
    assert.ok(existsSync(written), "the scaffold file was written");
    const onDisk = readFileSync(written, "utf8");
    assert.match(onDisk, /import \{ createGateway \} from "@streetjs\/gateway";/);
    assert.match(onDisk, /export function createEdgeGateway\(\): Gateway \{/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (3) Operational commands over an injected gateway/config ──────────────────────

test("gateway:routes prints each configured route as pattern → service", async () => {
  const { commands, gateway } = makeCommands();
  try {
    const { logs, exitCode } = await captureRun(() =>
      commands.gatewayRoutes(parsedArgs({ command: "gateway:routes" })),
    );
    assert.notEqual(exitCode, 1);
    const output = logs.join("\n");
    assert.match(output, /\/users\/\* → users/, "route is printed as pattern → service");
    assert.match(output, /1 route\(s\)/);
  } finally {
    await gateway.close();
  }
});

test("gateway:routes reports a clear message when no config is injected", async () => {
  const commands = new GatewayCommands();
  const { logs, exitCode } = await captureRun(() =>
    commands.gatewayRoutes(parsedArgs({ command: "gateway:routes" })),
  );
  assert.notEqual(exitCode, 1);
  assert.match(logs.join("\n"), /No gateway config available/);
});

test("gateway:health prints healthy/unhealthy counts and per-target state", async () => {
  const { commands, gateway } = makeCommands();
  try {
    const { logs, exitCode } = await captureRun(() =>
      commands.gatewayHealth(parsedArgs({ command: "gateway:health" })),
    );
    assert.notEqual(exitCode, 1);
    const output = logs.join("\n");
    // One target is unknown (fail-open, still counted healthy), one is unhealthy.
    assert.match(output, /healthy: 1, unhealthy: 1/);
    assert.match(output, /users\/users-1\tunknown/);
    assert.match(output, /users\/users-2\tunhealthy/);
  } finally {
    await gateway.close();
  }
});

test("gateway:health reports a clear message when no gateway is injected", async () => {
  const commands = new GatewayCommands();
  const { logs, exitCode } = await captureRun(() =>
    commands.gatewayHealth(parsedArgs({ command: "gateway:health" })),
  );
  assert.notEqual(exitCode, 1);
  assert.match(logs.join("\n"), /No gateway available/);
});
