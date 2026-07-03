// src/plugin.ts
// @streetjs/storage — plugin registration entry point (reuses the core
// PluginModule / SandboxedApp).
//
// `StoragePlugin.onLoad` constructs the facade via `createStorage`, which wires
// observability (health check + metrics) against the `metrics` / `health`
// registries supplied on the plugin options, applies the declarative bridge
// wiring, and exposes the live facade through the `storage` accessor.
// `onUnload` detaches the bridges and closes the facade gracefully
// (`storage.close()` stops the observability refresh timer).
//
// The `SandboxedApp` handed to a plugin exposes only `use` / `on` — it has no
// registry to attach to — so the health / metrics registries are resolved from
// the plugin options (mirroring how the events / queue / realtime plugins
// resolve theirs). The plugin never touches any existing public API: it only
// consumes the already-public `createStorage` surface (Requirements 20.1,
// 20.2, 20.3).

import { PluginModule } from "streetjs";
import type { SandboxedApp } from "streetjs";

import { createStorage, type Storage } from "./facade.js";
import type { StorageConfig, StorageMetadataMap } from "./types.js";

/**
 * Options for {@link StoragePlugin}.
 *
 * Extends {@link StorageConfig} directly, so every configuration value the
 * facade accepts — provider, driver, validation, versioning, signing secret,
 * the `metrics` / `health` registries the observability layer registers
 * against, the structural auth / image codec, and the structural
 * events / queue / realtime `bridges` the facade wires internally — is supplied
 * through the plugin options. Because a `SandboxedApp` exposes no registry, the
 * registries are resolved from these options rather than from the app.
 *
 * @typeParam T - Optional per-application custom metadata map.
 */
export interface StoragePluginOptions<T extends StorageMetadataMap = StorageMetadataMap>
  extends StorageConfig {
  /**
   * Declarative, imperative bridge wiring composed on top of the constructed
   * facade. Each entry is an attach function called with the live
   * {@link Storage} facade; if it returns a detach function, that detach is
   * invoked on `onUnload`. This keeps the plugin decoupled from any specific
   * integration instance — compose custom bridges without the plugin depending
   * on them, and have them torn down deterministically on unload:
   *
   * ```ts
   * new StoragePlugin({
   *   provider: "memory",
   *   metrics,
   *   health,
   *   wireBridges: [
   *     (storage) => attachAuditLog(storage, auditSink), // returns () => void
   *   ],
   * });
   * ```
   *
   * Distinct from the inherited structural `bridges`
   * (events / queue / realtime), which the facade wires internally at
   * construction time.
   */
  wireBridges?: Array<(storage: Storage<T>) => (() => void) | void>;
}

/**
 * Plugin entry point that constructs and wires the application storage layer.
 *
 * Compatible with the core {@link PluginModule} and safe to register with a
 * `SandboxedApp` (Requirements 20.1, 20.2). Once loaded, the application
 * retrieves the live {@link Storage} facade through the {@link storage}
 * accessor without any existing public API being modified (Requirement 20.3).
 *
 * @typeParam T - Optional per-application custom metadata map.
 */
export class StoragePlugin<
  T extends StorageMetadataMap = StorageMetadataMap,
> extends PluginModule {
  readonly name = "@streetjs/storage";
  readonly version = "1.0.0";

  protected readonly options: StoragePluginOptions<T>;

  private storageInstance?: Storage<T>;
  private bridgeDetachers: Array<() => void> = [];

  constructor(options: StoragePluginOptions<T>) {
    super();
    this.options = options;
  }

  /**
   * The constructed facade, or `undefined` before load / after unload. Because
   * the `SandboxedApp` has no registry to attach to, the application retrieves
   * the live {@link Storage} facade through this accessor after the plugin
   * loads (Requirement 20.3).
   */
  get storage(): Storage<T> | undefined {
    return this.storageInstance;
  }

  /**
   * Construct the facade (which wires observability from the configured
   * `metrics` / `health` registries and the structural bridges), apply the
   * declarative bridge wiring collecting any detach functions, and expose the
   * facade. Idempotent per load: a second `onLoad` without an intervening
   * `onUnload` reuses the already-constructed facade.
   */
  override async onLoad(_app: SandboxedApp): Promise<void> {
    if (this.storageInstance) {
      return;
    }

    // `createStorage` resolves the driver and, when `metrics` / `health` are
    // present on the config, registers storage observability against those
    // registries and primes the gauges — so passing the plugin options through
    // as the StorageConfig wires observability from the plugin-option
    // registries (Requirement 23.1, 23.3). The structural events / queue /
    // realtime bridges on `options.bridges` are likewise wired by the facade.
    const storage = createStorage<T>(this.options);
    this.storageInstance = storage;

    // Apply declarative bridge wiring, collecting any detach functions so
    // onUnload can tear them down.
    for (const attach of this.options.wireBridges ?? []) {
      const detach = attach(storage);
      if (typeof detach === "function") {
        this.bridgeDetachers.push(detach);
      }
    }
  }

  /**
   * Detach the declarative bridges and close the facade gracefully (which stops
   * the observability refresh timer). Safe if never loaded.
   */
  override async onUnload(_app: SandboxedApp): Promise<void> {
    const storage = this.storageInstance;
    const detachers = this.bridgeDetachers;
    this.storageInstance = undefined;
    this.bridgeDetachers = [];
    // Detach bridges first so no bridge fires during/after teardown.
    for (const detach of detachers) {
      try {
        detach();
      } catch {
        /* best-effort detach */
      }
    }
    if (storage) {
      await storage.close();
    }
  }
}
