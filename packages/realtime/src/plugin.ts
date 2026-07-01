// src/plugin.ts
// Plugin registration entry point (Req 1.4).
//
// `RealtimePlugin` integrates with the existing StreetJS plugin mechanism
// (`PluginModule` / `PluginHost`). Its `onLoad` constructs the facade, attaches
// it to the app's WebSocket server, and registers health/metrics. Concrete
// wiring lands in task 12.1; this scaffold establishes the exported typed surface.

import { PluginModule } from 'streetjs';
import type { SandboxedApp } from 'streetjs';
import type { RealtimeOptions } from './facade.js';

/** Plugin entry point that registers the Realtime_Framework (Req 1.4). */
export class RealtimePlugin extends PluginModule {
  readonly name = '@streetjs/realtime';
  readonly version = '1.0.0';

  protected readonly options: RealtimeOptions;

  constructor(options: RealtimeOptions) {
    super();
    this.options = options;
  }

  override async onLoad(_app: SandboxedApp): Promise<void> {
    throw new Error('RealtimePlugin is not implemented yet (see task 12.1)');
  }

  override async onUnload(_app: SandboxedApp): Promise<void> {
    throw new Error('RealtimePlugin is not implemented yet (see task 12.1)');
  }
}
