// src/plugin.ts
// @streetjs/events — plugin registration entry point (reuses the core
// PluginModule / SandboxedApp).
//
// `EventsPlugin.onLoad` constructs the facade via `createEvents`, wires
// observability (health check + metrics) against the registries supplied on the
// plugin options, runs the application's startup `register` hook so plugins /
// modules can subscribe their listeners during startup, and exposes the live
// facade through the `events` accessor. `onUnload` closes observability and the
// facade gracefully.
//
// The SandboxedApp handed to a plugin exposes only `use`/`on`, so the
// health/metrics registries are resolved from the plugin options (mirroring how
// the queue and realtime plugins resolve theirs).

import { PluginModule } from 'streetjs';
import type { HealthCheckRegistry, MetricsRegistry, SandboxedApp } from 'streetjs';
import type { AnyEventMap, EventMap } from './event.js';
import { createEvents, type Events, type EventsOptions } from './facade.js';
import {
  registerEventsObservability,
  type EventsObservabilityHandle,
} from './observability.js';

/** Options for {@link EventsPlugin}. Extends the facade options with registries. */
export interface EventsPluginOptions<T extends AnyEventMap = EventMap> extends EventsOptions {
  /** Health registry the `events` check is registered against. */
  health?: HealthCheckRegistry;
  /** Metrics registry the event metrics are exported through. */
  metrics?: MetricsRegistry;
  /**
   * Startup hook invoked with the constructed facade so plugins/modules can
   * register their listeners during load ("plugins register listeners during
   * startup"). May be async; awaited before `onLoad` resolves.
   */
  register?: (events: Events<T>) => void | Promise<void>;
}

/** Plugin entry point that constructs and wires the application event layer. */
export class EventsPlugin<T extends AnyEventMap = EventMap> extends PluginModule {
  readonly name = '@streetjs/events';
  readonly version = '1.0.0';

  protected readonly options: EventsPluginOptions<T>;

  private eventsInstance?: Events<T>;
  private observability?: EventsObservabilityHandle;

  constructor(options: EventsPluginOptions<T> = {}) {
    super();
    this.options = options;
  }

  /**
   * The constructed facade, or `undefined` before load / after unload. Because
   * the `SandboxedApp` has no registry to attach to, the application retrieves
   * the live {@link Events} facade through this accessor after the plugin loads.
   */
  get events(): Events<T> | undefined {
    return this.eventsInstance;
  }

  /**
   * Construct the facade, wire observability (health + metrics) against the
   * configured registries, run the startup `register` hook, and expose the
   * facade. Idempotent per load: a second `onLoad` without an intervening
   * `onUnload` reuses the already-constructed facade.
   */
  override async onLoad(_app: SandboxedApp): Promise<void> {
    if (this.eventsInstance) {
      return;
    }

    const obs = registerEventsObservability({
      health: this.options.health,
      metrics: this.options.metrics,
    });
    this.observability = obs;

    const events = createEvents<T>({
      clock: this.options.clock,
      store: this.options.store,
      persist: this.options.persist,
      onError: this.options.onError,
      // Merge the app-supplied telemetry (if any) with the observability sink so
      // both receive dispatch signals.
      telemetry: mergeTelemetry(obs.telemetry, this.options.telemetry),
    });
    this.eventsInstance = events;

    obs.attach(events);

    if (this.options.register) {
      await this.options.register(events);
    }
  }

  /** Close observability and the facade gracefully. Safe if never loaded. */
  override async onUnload(_app: SandboxedApp): Promise<void> {
    const obs = this.observability;
    const events = this.eventsInstance;
    this.observability = undefined;
    this.eventsInstance = undefined;
    obs?.close();
    if (events) {
      await events.close();
    }
  }
}

/** Fan-out two telemetry sinks into one; either may be undefined. */
function mergeTelemetry(
  a: EventsOptions['telemetry'],
  b: EventsOptions['telemetry'],
): EventsOptions['telemetry'] {
  if (!a) return b;
  if (!b) return a;
  return {
    onPublished: (ctx) => {
      a.onPublished?.(ctx);
      b.onPublished?.(ctx);
    },
    onDelivered: (ctx, ms) => {
      a.onDelivered?.(ctx, ms);
      b.onDelivered?.(ctx, ms);
    },
    onFailed: (ctx, err) => {
      a.onFailed?.(ctx, err);
      b.onFailed?.(ctx, err);
    },
    onDispatchComplete: (ctx, ms, delivered, failed) => {
      a.onDispatchComplete?.(ctx, ms, delivered, failed);
      b.onDispatchComplete?.(ctx, ms, delivered, failed);
    },
  };
}
