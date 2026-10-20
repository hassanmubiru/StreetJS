import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createContainer,
  streetApp,
  PluginModule,
  Controller,
  Get,
} from 'streetjs';

const APP_TOKEN = Symbol('app');
const SINGLETON = Symbol('singleton');
const TRANSIENT = Symbol('transient');
const SCOPED = Symbol('scoped');

const apps = [];

after(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function nextPort(app) {
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

async function request(app, path) {
  return fetch(`http://127.0.0.1:${nextPort(app)}${path}`);
}

describe('StreetJS framework conformance (built package)', () => {
  it('keeps application instances and singleton/transient/scoped lifetimes isolated', async () => {
    const first = streetApp({ container: createContainer(), containerOwnership: 'app' });
    const second = streetApp({ container: createContainer(), containerOwnership: 'app' });
    apps.push(first, second);

    assert.notEqual(first.container, second.container);
    first.container.registerValue(APP_TOKEN, 'first');
    second.container.registerValue(APP_TOKEN, 'second');
    assert.equal(first.container.resolve(APP_TOKEN), 'first');
    assert.equal(second.container.resolve(APP_TOKEN), 'second');

    first.use(async (ctx, next) => {
      if (ctx.path === '/identity') {
        ctx.json({ application: first.container.resolve(APP_TOKEN) });
        return;
      }
      await next();
    });
    second.use(async (ctx, next) => {
      if (ctx.path === '/identity') {
        ctx.json({ application: second.container.resolve(APP_TOKEN) });
        return;
      }
      await next();
    });
    await first.listen(0, '127.0.0.1');
    await second.listen(0, '127.0.0.1');
    assert.deepEqual(await (await request(first, '/identity')).json(), { application: 'first' });
    assert.deepEqual(await (await request(second, '/identity')).json(), { application: 'second' });

    const singleton = {};
    first.container.registerFactory(SINGLETON, () => singleton, 'singleton');
    first.container.registerFactory(TRANSIENT, () => ({}), 'transient');
    first.container.registerFactory(SCOPED, () => ({}), 'scoped');

    assert.equal(first.container.resolve(SINGLETON), first.container.resolve(SINGLETON));
    assert.notEqual(first.container.resolve(TRANSIENT), first.container.resolve(TRANSIENT));
    const scopeA = first.container.createScope();
    const scopeB = first.container.createScope();
    assert.equal(scopeA.resolve(SCOPED), scopeA.resolve(SCOPED));
    assert.notEqual(scopeA.resolve(SCOPED), scopeB.resolve(SCOPED));
    assert.notEqual(scopeA.resolve(SCOPED), first.container.resolve(SCOPED));
    await scopeA.dispose();
    await scopeB.dispose();
    await first.close();
    await first.close();
    assert.deepEqual(await (await request(second, '/identity')).json(), { application: 'second' });
    assert.throws(() => first.container.resolve(APP_TOKEN), /disposed/);
    await second.close();
  });

  it('creates and disposes a request scope for each request', async () => {
    let disposed = 0;
    const app = streetApp({
      container: createContainer(),
      containerOwnership: 'app',
      requestScope: true,
    });
    apps.push(app);
    app.container.registerFactory(SCOPED, () => ({ dispose: () => { disposed++; } }), 'scoped');
    app.use(async (ctx, next) => {
      if (ctx.path === '/scope') {
        const value = ctx.container.resolve(SCOPED);
        ctx.json({ same: value === ctx.container.resolve(SCOPED) });
        return;
      }
      await next();
    });
    await app.listen(0, '127.0.0.1');

    assert.deepEqual(await (await request(app, '/scope')).json(), { same: true });
    assert.deepEqual(await (await request(app, '/scope')).json(), { same: true });
    assert.equal(disposed, 2);
  });

  it('uses strict routes and the canonical error envelope', async () => {
    const app = streetApp({
      container: createContainer(),
      containerOwnership: 'app',
      errorResponse: 'envelope',
    });
    apps.push(app);
    class Routes {
      known(ctx) { ctx.json({ ok: true }); }
      failure() { throw new Error('private detail'); }
    }
    Controller('')(Routes);
    for (const name of ['known', 'failure']) {
      Get(`/${name}`)(Routes.prototype, name, Object.getOwnPropertyDescriptor(Routes.prototype, name));
    }
    app.registerController(Routes);
    await app.listen(0, '127.0.0.1');

    const canonical = await request(app, '/known');
    assert.equal(canonical.status, 200);
    assert.deepEqual(await canonical.json(), { ok: true });

    const trailing = await request(app, '/known/');
    assert.equal(trailing.status, 404);
    assert.deepEqual(await trailing.json(), {
      code: 'NotFoundException',
      message: 'Route GET /known/ not found',
      status: 404,
    });

    const failure = await request(app, '/failure');
    assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), {
      code: 'internal_error',
      message: 'Internal Server Error',
    });
  });

  it('loads and unloads plugin middleware and cleanup resources', async () => {
    let cleanup = 0;
    let unloaded = 0;
    const app = streetApp({ container: createContainer(), containerOwnership: 'app' });
    apps.push(app);
    class ConformancePlugin extends PluginModule {
      name = 'conformance-plugin';
      version = '1.0.0';
      async onLoad(sandbox) {
        sandbox.use(async (ctx, next) => {
          ctx.setHeader('x-conformance-plugin', 'loaded');
          await next();
        });
        sandbox.addCleanup(() => { cleanup++; });
      }
      async onUnload() { unloaded++; }
    }
    const plugin = new ConformancePlugin();
    await app.listen(0, '127.0.0.1');
    await app.loadPlugin(plugin);
    class PluginController {
      handle(ctx) { ctx.json({ ok: true }); }
    }
    Controller('/plugin')(PluginController);
    Get('')(PluginController.prototype, 'handle', Object.getOwnPropertyDescriptor(PluginController.prototype, 'handle'));
    app.registerController(PluginController);
    const loaded = await request(app, '/plugin');
    assert.equal(loaded.headers.get('x-conformance-plugin'), 'loaded');
    await loaded.arrayBuffer();

    await app.unloadPlugin(plugin);
    assert.equal(unloaded, 1);
    assert.equal(cleanup, 1);
    const unloadedResponse = await request(app, '/plugin');
    assert.equal(unloadedResponse.headers.get('x-conformance-plugin'), null);
    await unloadedResponse.arrayBuffer();

    await app.loadPlugin(plugin);
    const reloaded = await request(app, '/plugin');
    assert.equal(reloaded.headers.get('x-conformance-plugin'), 'loaded');
    await reloaded.arrayBuffer();
    await app.unloadPlugin(plugin);
    assert.equal(unloaded, 2);
    assert.equal(cleanup, 2);
  });
});
