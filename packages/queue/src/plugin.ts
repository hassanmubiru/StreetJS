// src/plugin.ts
// @streetjs/queue — plugin registration entry point (Req 1.4, 12.1, 12.2).
//
// `QueuePlugin` integrates with the existing StreetJS plugin mechanism
// (`PluginModule` / `PluginHost`). Its `onLoad` constructs the facade via
// `createQueue` and registers queue observability (a health check + queue
// metrics) against the app's registries; `onUnload` stops the observability
// refresh and closes the queue gracefully. Applications may either construct
// the facade directly with `createQueue(options)` or register this plugin
// (`host.register(new QueuePlugin(options), manifest)` / `usePlugin`).
//
// Resolution note: the `SandboxedApp` handed to a plugin intentionally exposes
// only `use(middleware)` and `on(event, handler)` — it does NOT expose the
// application's observability registries. The queue subsystem therefore
// resolves those from `QueueOptions`: the health/metrics registries from
// `options.health`/`options.metrics` (mirroring how `createQueue` already
// accepts them and how `@streetjs/realtime`'s `RealtimePlugin` resolves its
// server/registries from `RealtimeOptions`). Because `createQueue` does not
// itself wire observability, `onLoad` registers it explicitly against those
// registries (Req 1.4, 12.1, 12.2).

import { PluginModule } from 'streetjs';
import type { SandboxedApp } from 'streetjs';
import { createQueue } from './facade.js';
import type { QueueOptions, Queue } from './facade.js';
import { registerQueueObservability } from './observability.js';
import type { QueueObservabilityHandle } from './observability.js';

/** Plugin entry point that registers the Queue_Package (Req 1.4). */
export class QueuePlugin extends PluginModule {
  readonly name = '@streetjs/queue';
  readonly version = '1.0.0';

  protected readonly options: QueueOptions;

  /** The facade constructed in {@link onLoad}; held so {@link onUnload} can close it. */
  private queueInstance?: Queue;

  /**
   * Observability handle returned by {@link registerQueueObservability} in
   * {@link onLoad}; held so {@link onUnload} can stop its refresh timer and
   * release resources. `undefined` until loaded and again after unload.
   */
  private observability?: QueueObservabilityHandle;

  constructor(options: QueueOptions = {}) {
    super();
    this.options = options;
  }

  /**
   * The facade constructed in {@link onLoad}, or `undefined` when the plugin has
   * not been loaded (or has been unloaded). Because the `SandboxedApp` has no
   * registry to attach the queue to, the application that constructed this
   * plugin retrieves the live {@link Queue} through this accessor after the
   * plugin is loaded — this is how the queue is "exposed to the app". Mirrors
   * the way `@streetjs/realtime`'s `RealtimePlugin` holds its facade instance.
   */
  get queue(): Queue | undefined {
    return this.queueInstance;
  }

  /**
   * Construct the facade via `createQueue` and register queue observability (a
   * health check + queue-length/worker-status/latency/processed/failure
   * metrics) against the registries configured on {@link QueueOptions}
   * (Req 1.4, 12.1, 12.2). The registries are resolved from `QueueOptions`
   * because the `SandboxedApp` does not expose them (see the module header).
   *
   * No worker is auto-started at load time, so observability is registered with
   * `worker` undefined: the health check maps driver connectivity (Req 12.1)
   * and worker liveness is attached later only if the application starts one via
   * `queue.work()`. Idempotent per load: a second `onLoad` without an
   * intervening `onUnload` reuses the already-constructed facade and does not
   * re-register.
   */
  override async onLoad(_app: SandboxedApp): Promise<void> {
    if (this.queueInstance) return;
    const queue = createQueue(this.options);
    this.queueInstance = queue;
    // Register observability against the app's registries (resolved from
    // options). `registerQueueObservability` is idempotent against a shared
    // registry and returns a no-op handle when no metrics registry is given, so
    // this is safe whether or not the application wired observability.
    this.observability = registerQueueObservability({
      driver: queue.driver,
      health: this.options.health,
      metrics: this.options.metrics,
    });
  }

  /**
   * Gracefully tear down the facade constructed in {@link onLoad}: stop the
   * observability refresh timer/release its resources and close the queue
   * (stopping workers/scheduler, draining in-flight, closing the driver). Safe
   * to call when the plugin was never loaded (no-op).
   */
  override async onUnload(_app: SandboxedApp): Promise<void> {
    const observability = this.observability;
    const queue = this.queueInstance;
    this.observability = undefined;
    this.queueInstance = undefined;
    observability?.close();
    if (queue) {
      await queue.close();
    }
  }
}
