// src/plugin.ts
// @streetjs/workflow — plugin registration entry point (reuses the core
// PluginModule / SandboxedApp).
//
// `WorkflowPlugin.onLoad` constructs the engine via `createWorkflow`, which
// wires observability (metrics + persistence-store health check) against the
// `metrics` / `health` registries supplied on the plugin options and, unless
// `autoResume` is disabled, resumes incomplete (non-terminal, non-cancelled)
// runs from the configured `WorkflowStore` at construction time. It then applies
// the declarative bridge wiring and exposes the live engine through the
// `workflow` accessor. `onUnload` detaches the declarative bridges and closes
// the engine gracefully (`engine.close()` settles in-flight auto-resume drives
// and releases the observability handle).
//
// The `SandboxedApp` handed to a plugin exposes only `use` / `on` — it has no
// registry to attach to — so the metrics / health registries are resolved from
// the plugin options (mirroring `@streetjs/storage` and the other pillar
// plugins). The plugin never touches any existing public API: it only consumes
// the already-public `createWorkflow` surface (Requirements 23.1, 23.2, 23.3).

import { PluginModule } from "streetjs";
import type { SandboxedApp } from "streetjs";

import { createWorkflow } from "./engine.js";
import type { WorkflowEngine } from "./engine.js";
import type { WorkflowConfig } from "./types.js";

/**
 * Options for {@link WorkflowPlugin}.
 *
 * Extends {@link WorkflowConfig} directly, so every configuration value the
 * engine accepts — the persistence `store`, injectable `clock`, injectable
 * `rng`, the `metrics` / `health` registries the observability layer registers
 * against, the four structural `bridges` (`storage` / `queue` / `events` /
 * `realtime`), and the `autoResume` toggle — is supplied through the plugin
 * options. Because a `SandboxedApp` exposes no registry, the registries are
 * resolved from these options rather than from the app.
 */
export interface WorkflowPluginOptions extends WorkflowConfig {
  /**
   * Declarative, imperative bridge wiring composed on top of the constructed
   * engine. Each entry is an attach function called with the live
   * {@link WorkflowEngine}; if it returns a detach function, that detach is
   * invoked on `onUnload` before the engine is closed. This keeps the plugin
   * decoupled from any specific integration instance — compose custom bridges
   * without the plugin depending on them, and have them torn down
   * deterministically on unload:
   *
   * ```ts
   * new WorkflowPlugin({
   *   metrics,
   *   health,
   *   bridges: { storage, queue, events, realtime },
   *   wireBridges: [
   *     (engine) => attachAuditLog(engine, auditSink), // returns () => void
   *   ],
   * });
   * ```
   *
   * Distinct from the inherited structural `bridges`
   * (storage / queue / events / realtime), which the engine wires internally at
   * construction time onto every run's `ctx`.
   */
  wireBridges?: Array<(engine: WorkflowEngine) => (() => void) | void>;
}

/**
 * Plugin entry point that constructs and wires the workflow engine.
 *
 * Compatible with the core {@link PluginModule} and safe to register with a
 * `SandboxedApp` (Requirements 23.1, 23.2). Once loaded, the application
 * retrieves the live {@link WorkflowEngine} through the {@link workflow}
 * accessor without any existing public API being modified (Requirement 23.3).
 */
export class WorkflowPlugin extends PluginModule {
  readonly name = "@streetjs/workflow";
  readonly version = "1.0.0";

  protected readonly options: WorkflowPluginOptions;

  private engineInstance?: WorkflowEngine;
  private bridgeDetachers: Array<() => void> = [];

  constructor(options: WorkflowPluginOptions = {}) {
    super();
    this.options = options;
  }

  /**
   * The constructed engine, or `undefined` before load / after unload. Because
   * the `SandboxedApp` has no registry to attach to, the application retrieves
   * the live {@link WorkflowEngine} through this accessor after the plugin loads
   * (Requirement 23.3).
   */
  get workflow(): WorkflowEngine | undefined {
    return this.engineInstance;
  }

  /**
   * Construct the engine (which wires observability from the configured
   * `metrics` / `health` registries and, unless disabled, resumes incomplete
   * runs from the store), apply the declarative bridge wiring collecting any
   * detach functions, and expose the engine. Idempotent per load: a second
   * `onLoad` without an intervening `onUnload` reuses the already-constructed
   * engine.
   */
  override async onLoad(_app: SandboxedApp): Promise<void> {
    if (this.engineInstance) {
      return;
    }

    // `createWorkflow` registers workflow observability against the config's
    // `metrics` / `health` registries and, when `autoResume` is not disabled,
    // resumes non-terminal (non-cancelled) runs held by the configured store —
    // so passing the plugin options through as the WorkflowConfig wires
    // observability from the plugin-option registries and resumes incomplete
    // runs (Requirements 23.1, 23.3). The structural storage / queue / events /
    // realtime bridges on `options.bridges` are likewise threaded onto every
    // run's `ctx` by the engine.
    const engine = createWorkflow(this.options);
    this.engineInstance = engine;

    // Apply declarative bridge wiring, collecting any detach functions so
    // onUnload can tear them down.
    for (const attach of this.options.wireBridges ?? []) {
      const detach = attach(engine);
      if (typeof detach === "function") {
        this.bridgeDetachers.push(detach);
      }
    }
  }

  /**
   * Detach the declarative bridges and close the engine gracefully (which
   * settles in-flight auto-resume drives and releases the observability handle).
   * Safe if never loaded.
   */
  override async onUnload(_app: SandboxedApp): Promise<void> {
    const engine = this.engineInstance;
    const detachers = this.bridgeDetachers;
    this.engineInstance = undefined;
    this.bridgeDetachers = [];
    // Detach bridges first so no bridge fires during/after teardown.
    for (const detach of detachers) {
      try {
        detach();
      } catch {
        /* best-effort detach */
      }
    }
    if (engine) {
      await engine.close();
    }
  }
}
