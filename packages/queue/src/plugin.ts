// src/plugin.ts
// @streetjs/queue — plugin registration entry point (Req 1.4, 12.1, 12.2).
//
// `QueuePlugin` integrates with the existing StreetJS plugin mechanism
// (`PluginModule` / `PluginHost`). Its `onLoad` constructs the facade via
// `createQueue` and (in task 13.1) registers queue observability against the
// app's registries; `onUnload` closes the queue gracefully. Applications may
// either construct the facade directly with `createQueue(options)` or register
// this plugin.

import { PluginModule } from 'streetjs';
import type { SandboxedApp } from 'streetjs';
import { createQueue } from './facade.js';
import type { QueueOptions, Queue } from './facade.js';

/** Plugin entry point that registers the Queue_Package (Req 1.4). */
export class QueuePlugin extends PluginModule {
  readonly name = '@streetjs/queue';
  readonly version = '1.0.0';

  protected readonly options: QueueOptions;

  /** The facade constructed in {@link onLoad}; held so {@link onUnload} can close it. */
  private queue?: Queue;

  constructor(options: QueueOptions = {}) {
    super();
    this.options = options;
  }

  /**
   * Construct the facade via `createQueue` and register observability. Idempotent
   * per load: a second `onLoad` without an intervening `onUnload` reuses the
   * already-constructed facade. Observability registration lands in task 13.1.
   */
  override async onLoad(_app: SandboxedApp): Promise<void> {
    if (this.queue) return;
    this.queue = createQueue(this.options);
  }

  /** Gracefully close the facade constructed in {@link onLoad}. Safe if never loaded. */
  override async onUnload(_app: SandboxedApp): Promise<void> {
    if (!this.queue) return;
    const queue = this.queue;
    this.queue = undefined;
    await queue.close();
  }
}
