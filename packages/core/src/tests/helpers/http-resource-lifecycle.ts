import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { test } from 'node:test';
import type { StreetApp } from '../../http/server.js';
import type { PluginModule } from '../../platform/plugins/sdk.js';

export interface HttpRequestProbe {
  request?: IncomingMessage;
  scopeDisposed: number;
}

export interface HttpLifecycleHarnessOptions {
  name: string;
  createApp(): StreetApp;
  request?(app: StreetApp, probe: HttpRequestProbe): Promise<void>;
}

function plugin(name: string, cleanup: () => void): PluginModule {
  return {
    name,
    version: '1.0.0',
    async onLoad(sandbox) {
      sandbox.on('ready', () => {});
      sandbox.addCleanup(cleanup);
      sandbox.use(async (_ctx, next) => { await next(); });
    },
  };
}

/** Shared ownership contract for HTTP adapters. */
export function defineHttpResourceLifecycleConformance(options: HttpLifecycleHarnessOptions): void {
  test(`${options.name}: normal close releases timers, requests, plugins, scopes, and container resources`, async () => {
    const app = options.createApp();
    let timerTicks = 0;
    let timerClosed = 0;
    let resourceClosed = 0;
    const timer = setInterval(() => { timerTicks++; }, 5);
    timer.unref();
    class Resource {
      close(): void { resourceClosed++; }
    }
    class TimerResource {
      close(): void { clearInterval(timer); timerClosed++; }
    }
    app.container.register(Resource, new Resource());
    app.container.register(TimerResource, new TimerResource());

    const scopeToken = Symbol(`${options.name}-scope`);
    const probe: HttpRequestProbe = { scopeDisposed: 0 };
    app.container.registerFactory(scopeToken, () => ({ close(): void { probe.scopeDisposed++; } }), 'scoped');
    app.use(async (ctx, next) => {
      probe.request = ctx.req;
      ctx.container?.resolve(scopeToken);
      await next();
    });

    let pluginCleanup = 0;
    await app.loadPlugin(plugin(`${options.name}-normal`, () => { pluginCleanup++; }));
    if (options.request) await options.request(app, probe);
    const ticksBeforeClose = timerTicks;
    const closePromise = app.close();
    assert.equal(closePromise, app.close());
    await closePromise;
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
    assert.equal(app.lifecycleState, 'CLOSED');
    assert.equal(pluginCleanup, 1);
    assert.equal(resourceClosed, 1);
    assert.equal(timerClosed, 1);
    assert.equal(timerTicks, ticksBeforeClose);
    if (options.request) {
      assert.equal(probe.scopeDisposed, 1);
      assert.ok(probe.request);
      assert.equal(probe.request.listenerCount('aborted'), 0);
      assert.equal(probe.request.listenerCount('close'), 0);
    }
    await app.close();
    assert.equal(pluginCleanup, 1);
    assert.equal(resourceClosed, 1);
  });

  test(`${options.name}: cleanup failure still runs remaining cleanup and preserves isolation`, async () => {
    const first = options.createApp();
    const second = options.createApp();
    let firstPluginCleanup = 0;
    let firstPluginFollowup = 0;
    let secondPluginCleanup = 0;
    let firstResourceClosed = 0;
    let secondResourceClosed = 0;
    class FirstResource { close(): void { firstResourceClosed++; } }
    class SecondResource { close(): void { secondResourceClosed++; } }
    first.container.register(FirstResource, new FirstResource());
    second.container.register(SecondResource, new SecondResource());
    await first.loadPlugin({
      name: `${options.name}-failure`,
      version: '1.0.0',
      async onLoad(sandbox) {
        sandbox.addCleanup(() => { firstPluginCleanup++; throw new Error('plugin cleanup failed'); });
        sandbox.addCleanup(() => { firstPluginFollowup++; });
        sandbox.use(async (_ctx, next) => { await next(); });
      },
    });
    await second.loadPlugin(plugin(`${options.name}-isolated`, () => { secondPluginCleanup++; }));

    const firstClose = first.close();
    await assert.rejects(firstClose, (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 1);
      return true;
    });
    assert.equal(first.lifecycleState, 'DRAINING');
    assert.equal(firstPluginCleanup, 1);
    assert.equal(firstPluginFollowup, 1);
    assert.equal(firstResourceClosed, 1);
    assert.equal(second.lifecycleState, 'CREATED');
    assert.equal(secondPluginCleanup, 0);
    assert.equal(secondResourceClosed, 0);
    await second.close();
    assert.equal(secondPluginCleanup, 1);
    assert.equal(secondResourceClosed, 1);
    assert.equal(first.close(), firstClose);
  });

  test(`${options.name}: failed startup disposes app-owned resources`, async () => {
    const app = options.createApp();
    let disposed = 0;
    class StartupResource { close(): void { disposed++; } }
    app.container.register(StartupResource, new StartupResource());
    await assert.rejects(app.listen(-1, '127.0.0.1'));
    await assert.rejects(app.close());
    assert.equal(disposed, 1);
    assert.equal(app.lifecycleState, 'CLOSED');
  });
}
