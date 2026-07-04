// src/cli/commands.ts
// @streetjs/gateway — CLI commands registered through the reused core CliKernel.
//
// Provides `make:gateway-route`, `make:proxy`, `gateway:routes`, and
// `gateway:health` as `@Command`-decorated methods.
//
// `make:gateway-route`/`make:proxy` delegate to the PURE functions in
// `generators.ts`: the name is validated and the scaffold rendered before this
// command layer performs the single guarded filesystem write, refusing to
// overwrite an existing target. The operational commands read from an injected
// `Gateway` and/or the `GatewayConfig` used to build it: `gateway:routes` prints
// each configured route as pattern → service, and `gateway:health` prints the
// upstream health (healthy/unhealthy counts plus per-target state). Both default
// gracefully with a clear message when no gateway/config is injected.
//
// No class-level decorator is used, so the core `CliKernel` can
// `container.resolve` the class with no constructor dependency metadata —
// mirroring the sibling `packages/workflow/src/cli/commands.ts` pattern.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { Command } from "streetjs";
import type { ParsedArgs } from "streetjs";

import type { Gateway } from "../gateway.js";
import type { GatewayConfig, HealthState } from "../types.js";
import type { GenerateResult } from "./generators.js";
import {
  DEFAULT_PROXY_DIR,
  DEFAULT_ROUTE_DIR,
  generateGatewayRoute,
  generateProxy,
  isValidGeneratorName,
} from "./generators.js";

/**
 * The set of `@Command`-decorated gateway commands, registered through the core
 * `CliKernel`. A plain class (no class-level decorator) so the kernel can
 * `container.resolve` it without constructor dependency metadata; the optional
 * `gateway`/`config` arguments are only used when the class is constructed
 * directly (e.g. by the CLI tests) to drive the operational commands.
 */
export class GatewayCommands {
  /** The injected gateway backing the operational commands, when provided. */
  private readonly gateway: Gateway | undefined;
  /** The injected config the gateway was built from, when provided. */
  private readonly config: GatewayConfig | undefined;

  constructor(gateway?: Gateway, config?: GatewayConfig) {
    this.gateway = gateway;
    this.config = config;
  }

  // ── make:gateway-route ───────────────────────────────────────────────────────

  /**
   * `street make:gateway-route <Name> [--dir <dir>]` — scaffold a typed
   * {@link RouteConfig} module. Delegates to the pure {@link generateGatewayRoute}:
   * the name is validated and the source rendered before this layer writes it,
   * and an existing target is never overwritten.
   */
  @Command(
    "make:gateway-route",
    "Scaffold a new gateway route module (make:gateway-route <Name> [--dir <dir>])",
  )
  makeGatewayRoute(args: ParsedArgs): void {
    this.scaffold(args, "route", generateGatewayRoute, DEFAULT_ROUTE_DIR);
  }

  // ── make:proxy ─────────────────────────────────────────────────────────────

  /**
   * `street make:proxy <Name> [--dir <dir>]` — scaffold a small proxy/gateway
   * setup module. Delegates to the pure {@link generateProxy} with the same
   * validate-before-write, no-overwrite guarantees.
   */
  @Command(
    "make:proxy",
    "Scaffold a new proxy/gateway setup module (make:proxy <Name> [--dir <dir>])",
  )
  makeProxy(args: ParsedArgs): void {
    this.scaffold(args, "proxy", generateProxy, DEFAULT_PROXY_DIR);
  }

  // ── gateway:routes ─────────────────────────────────────────────────────────

  /**
   * `street gateway:routes` — print each configured route as `pattern → service`
   * from the injected {@link GatewayConfig}. When no config was injected, print a
   * clear message instead.
   */
  @Command("gateway:routes", "List each configured route as pattern → service")
  gatewayRoutes(_args: ParsedArgs): void {
    if (this.config === undefined) {
      console.log(
        "[gateway] No gateway config available. Construct GatewayCommands with a GatewayConfig to list routes.",
      );
      return;
    }
    const routes = this.config.routes;
    if (routes.length === 0) {
      console.log("[gateway] No routes configured.");
      return;
    }
    for (const route of routes) {
      console.log(`${route.pattern} → ${route.service}`);
    }
    console.log(`[gateway] ${routes.length} route(s).`);
  }

  // ── gateway:health ─────────────────────────────────────────────────────────

  /**
   * `street gateway:health` — print upstream health from the injected gateway's
   * `stats()` (healthy/unhealthy counts) and per-target state from its health
   * registry (using the injected config's services to enumerate targets). When no
   * gateway was injected, print a clear message instead.
   */
  @Command(
    "gateway:health",
    "Print upstream health: healthy/unhealthy counts and per-target state",
  )
  gatewayHealth(_args: ParsedArgs): void {
    if (this.gateway === undefined) {
      console.log(
        "[gateway] No gateway available. Construct GatewayCommands with a Gateway to report health.",
      );
      return;
    }
    const stats = this.gateway.stats();
    console.log(
      `[gateway] healthy: ${stats.healthyUpstreams}, unhealthy: ${stats.unhealthyUpstreams}`,
    );

    if (this.config === undefined) {
      return;
    }
    for (const service of this.config.services) {
      for (const target of service.targets) {
        const state: HealthState = this.gateway.health.get(target.id)?.state ?? "unknown";
        console.log(`${service.name}/${target.id}\t${state}`);
      }
    }
  }

  // ── Shared helpers ───────────────────────────────────────────────────────────

  /**
   * Shared `make:*` body: validate the name, render the scaffold through the pure
   * generator, then perform the single guarded write. Any invalid name or
   * existing target is reported and sets a non-zero exit code without writing.
   */
  private scaffold(
    args: ParsedArgs,
    kind: "route" | "proxy",
    generate: (name: string, dir: string) => GenerateResult,
    defaultDir: string,
  ): void {
    const name = this.resolveName(args);
    if (!isValidGeneratorName(name)) {
      console.error(
        `[gateway] Invalid ${kind} name: "${name}". ` +
          `Use a PascalCase identifier (an upper-case letter followed by letters or digits).`,
      );
      process.exitCode = 1;
      return;
    }

    const dir = typeof args.flags["dir"] === "string" ? args.flags["dir"] : defaultDir;

    let result: GenerateResult;
    try {
      result = generate(name, dir);
      this.writeScaffold(result);
    } catch (err) {
      console.error(`[gateway] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[gateway] Generated ${kind} module: ${result.path}`);
  }

  /**
   * Write a generated scaffold to disk, refusing to overwrite an existing target
   * and creating a fresh file otherwise. The parent directory is created as
   * needed; the `wx` flag makes the no-overwrite check atomic.
   *
   * @throws Error when the target file already exists.
   */
  private writeScaffold(result: GenerateResult): void {
    if (existsSync(result.path)) {
      throw new Error(`Refusing to overwrite existing file: ${result.path}`);
    }
    mkdirSync(dirname(result.path), { recursive: true });
    writeFileSync(result.path, result.contents, { encoding: "utf8", flag: "wx" });
  }

  /** Read the generator name from the first positional arg or `--name`. */
  private resolveName(args: ParsedArgs): string {
    const positional = args.positional[0];
    if (typeof positional === "string") {
      return positional;
    }
    return typeof args.flags["name"] === "string" ? args.flags["name"] : "";
  }
}
