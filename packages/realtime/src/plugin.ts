// src/plugin.ts
// Plugin registration entry point (Req 1.4).
//
// `RealtimePlugin` integrates with the existing StreetJS plugin mechanism
// (`PluginModule` / `PluginHost`). Its `onLoad` constructs the facade over the
// configured WebSocket server and registers realtime observability (a health
// check + connection/member-count metrics, Req 17); `onUnload` tears the facade
// down. Applications may either construct the facade directly with
// `createRealtime(options)` or register this plugin
// (`host.register(new RealtimePlugin(options), manifest)` / `usePlugin`).
//
// Resolution note: the `SandboxedApp` handed to a plugin intentionally exposes
// only `use(middleware)` and `on(event, handler)` — it does NOT expose the
// application's `StreetWebSocketServer` or the observability registries. The
// realtime subsystem therefore resolves those from `RealtimeOptions`: the
// server from `options.server`, and the health/metrics registries from
// `options.health`/`options.metrics`. `createRealtime` performs the server
// attachment and, whenever a health and/or metrics registry is present,
// registers the realtime observability, so constructing the facade here is what
// registers the health check and metrics (Req 1.4, 17.1, 17.2, 17.4).

import { PluginModule } from 'streetjs';
import type { SandboxedApp } from 'streetjs';
import { createRealtime } from './facade.js';
import type { RealtimeOptions, Realtime } from './facade.js';

/** Plugin entry point that registers the Realtime_Framework (Req 1.4). */
export class RealtimePlugin extends PluginModule {
  readonly name = '@streetjs/realtime';
  readonly version = '1.0.0';

  protected readonly options: RealtimeOptions;

  /**
   * The facade constructed in {@link onLoad}. Held so {@link onUnload} can tear
   * it down (closing the cluster adapter and stopping the observability refresh
   * timer). `undefined` until loaded and again after unload.
   */
  private realtime?: Realtime;

  constructor(options: RealtimeOptions) {
    super();
    this.options = options;
  }

  /**
   * Construct the facade over the configured `StreetWebSocketServer` and, when a
   * health and/or metrics registry is configured on {@link RealtimeOptions},
   * register the realtime health check and connection/member-count metrics
   * (Req 1.4, 17.1, 17.2, 17.4). The server and registries are resolved from
   * `RealtimeOptions` because the `SandboxedApp` does not expose them (see the
   * module header). Idempotent per load: a second `onLoad` without an
   * intervening `onUnload` reuses the already-constructed facade.
   */
  override async onLoad(_app: SandboxedApp): Promise<void> {
    if (this.realtime) return;
    // createRealtime attaches upgrade auth to options.server and registers the
    // health check + metrics from options.health/options.metrics (Req 17).
    this.realtime = createRealtime(this.options);
  }

  /**
   * Gracefully tear down the facade constructed in {@link onLoad}: closes the
   * cluster adapter and stops the observability refresh timer. Safe to call when
   * the plugin was never loaded (no-op).
   */
  override async onUnload(_app: SandboxedApp): Promise<void> {
    if (!this.realtime) return;
    const realtime = this.realtime;
    this.realtime = undefined;
    await realtime.close();
  }
}
