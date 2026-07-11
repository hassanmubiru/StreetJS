// examples/plugin-starter/src/index.ts
// A minimal, dependency-free StreetJS plugin. Copy this directory, rename it,
// and replace the middleware/lifecycle logic with your own. See the author guide:
// https://github.com/hassanmubiru/StreetJS/blob/main/docs/plugin-authoring.md

import { PluginModule, type SandboxedApp } from 'streetjs';

/** Example plugin: adds an `x-hello` response header via middleware. */
export class HelloPlugin extends PluginModule {
  readonly name = 'street-plugin-hello';
  readonly version = '1.0.0';

  /** One-time setup (migrations, etc.). Optional. */
  async onInstall(): Promise<void> {
    // e.g. run a migration once when the plugin is first installed.
  }

  /** Runs each time the app loads the plugin. Register middleware + listeners. */
  async onLoad(app: SandboxedApp): Promise<void> {
    app.use(async (ctx, next) => {
      await next();
      // set a header after downstream handlers run
      (ctx as { res?: { setHeader?: (k: string, v: string) => void } }).res?.setHeader?.(
        'x-hello',
        'street',
      );
    });
    app.on('server:ready', () => {
      // react to framework lifecycle events here
    });
  }

  /** Cleanup on unload. Optional. */
  async onUnload(_app: SandboxedApp): Promise<void> {}
}

export default HelloPlugin;
