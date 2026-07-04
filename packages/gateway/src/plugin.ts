// src/plugin.ts
// @streetjs/gateway — plugin registration entry point (reuses the core
// PluginModule / SandboxedApp).
//
// `GatewayPlugin.onLoad` constructs the request pipeline via `createGateway`,
// applies any declarative `wireMiddleware` against the live gateway, and
// exposes the constructed gateway through the `gateway` accessor. `onUnload`
// closes the gateway gracefully (`gateway.close()` releases the observability
// handle) and clears the accessor.
//
// The `SandboxedApp` handed to a plugin exposes only `use` / `on` — it has no
// registry to attach to — so the entire gateway configuration is resolved from
// the plugin options rather than from the app (mirroring the sibling
// `@streetjs/workflow` plugin). The plugin never touches any existing public
// API: it only consumes the already-public `createGateway` surface.

import { PluginModule } from "streetjs";
import type { SandboxedApp } from "streetjs";

import { createGateway, type Gateway } from "./gateway.js";
import type { GatewayConfig } from "./types.js";

/**
 * Options for {@link GatewayPlugin}.
 *
 * Extends {@link GatewayConfig} directly, so every configuration value the
 * gateway accepts — the `routes`, `services`, resilience/security `defaults`,
 * `cors`, `versioning`, `compression`, `security`, the injectable `clock` /
 * `rng`, the `logSink`, and the injectable `forwarder` — is supplied through
 * the plugin options. Because a `SandboxedApp` exposes no registry, the
 * configuration is resolved from these options rather than from the app.
 */
export interface GatewayPluginOptions extends GatewayConfig {
  /**
   * Declarative middleware wiring composed on top of the constructed gateway.
   * Each entry is called with the live {@link Gateway} on load, letting callers
   * register global middleware (via `gw.use(...)`) or perform other imperative
   * setup without the plugin depending on any specific integration:
   *
   * ```ts
   * new GatewayPlugin({
   *   routes,
   *   services,
   *   wireMiddleware: [
   *     (gw) => gw.use(requestIdMiddleware),
   *   ],
   * });
   * ```
   */
  wireMiddleware?: Array<(gw: Gateway) => void>;
}

/**
 * Plugin entry point that constructs and wires the gateway pipeline.
 *
 * Compatible with the core {@link PluginModule} and safe to register with a
 * `SandboxedApp`. Once loaded, the application retrieves the live
 * {@link Gateway} through the {@link gateway} accessor without any existing
 * public API being modified.
 */
export class GatewayPlugin extends PluginModule {
  readonly name = "@streetjs/gateway";
  readonly version = "1.0.0";

  protected readonly options: GatewayPluginOptions;

  private gatewayInstance?: Gateway;

  constructor(options: GatewayPluginOptions) {
    super();
    this.options = options;
  }

  /**
   * The constructed gateway, or `undefined` before load / after unload. Because
   * the `SandboxedApp` has no registry to attach to, the application retrieves
   * the live {@link Gateway} through this accessor after the plugin loads.
   */
  get gateway(): Gateway | undefined {
    return this.gatewayInstance;
  }

  /**
   * Construct the gateway from the plugin options (resolving the config from the
   * options, not the app, per the `SandboxedApp` constraints), apply any
   * declarative `wireMiddleware` against the live gateway, and expose it.
   * Idempotent per load: a second `onLoad` without an intervening `onUnload`
   * reuses the already-constructed gateway.
   */
  override async onLoad(_app: SandboxedApp): Promise<void> {
    if (this.gatewayInstance) {
      return;
    }

    const gateway = createGateway(this.options);
    this.gatewayInstance = gateway;

    // Apply declarative middleware wiring against the live gateway.
    for (const wire of this.options.wireMiddleware ?? []) {
      wire(gateway);
    }
  }

  /**
   * Close the gateway gracefully (releasing the observability handle) and clear
   * the accessor. Safe if never loaded.
   */
  override async onUnload(_app: SandboxedApp): Promise<void> {
    const gateway = this.gatewayInstance;
    this.gatewayInstance = undefined;
    if (gateway) {
      await gateway.close();
    }
  }
}
