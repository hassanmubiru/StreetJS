// tests/plugin-host.test.ts
// Verifies the formal plugin system: semver constraint matching, manifest
// integrity + real Ed25519 signature verification, registration, permission
// gating, dependency/version resolution with lifecycle ordering, discovery,
// and disable/remove safety. Uses only node:test/node:crypto.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  PluginHost,
  signManifest, verifyManifest, manifestChecksum,
  satisfiesVersion, compareSemver, parseSemver,
  PluginPermissionError, PluginDependencyError, PluginSignatureError, PluginStateError,
  type PluginManifest,
} from '../platform/plugins/host.js';
import { PluginModule, type SandboxedApp } from '../platform/plugins/sdk.js';
import type { StreetContext } from '../core/context.js';

// A configurable test plugin that records lifecycle calls into a shared log.
class TestPlugin extends PluginModule {
  installed = 0; loaded = 0; unloaded = 0;
  constructor(
    readonly name: string,
    readonly version: string,
    private readonly log: string[] = [],
    private readonly useMiddleware = false,
  ) { super(); }
  async onInstall(): Promise<void> { this.installed++; this.log.push(`install:${this.name}`); }
  async onLoad(app: SandboxedApp): Promise<void> {
    this.loaded++; this.log.push(`load:${this.name}`);
    if (this.useMiddleware) app.use(async (_ctx: StreetContext, next: () => Promise<void>) => { await next(); });
  }
  async onUnload(): Promise<void> { this.unloaded++; this.log.push(`unload:${this.name}`); }
}

describe('plugin host — semver', () => {
  it('parses and compares versions', () => {
    assert.deepEqual(parseSemver('v2.3.4-rc.1'), { major: 2, minor: 3, patch: 4 });
    assert.equal(compareSemver('1.2.3', '1.2.4'), -1);
    assert.equal(compareSemver('2.0.0', '1.9.9'), 1);
    assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  });
  it('matches caret/tilde/comparator/exact/any ranges', () => {
    assert.equal(satisfiesVersion('1.4.2', '^1.2.0'), true);
    assert.equal(satisfiesVersion('2.0.0', '^1.2.0'), false);
    assert.equal(satisfiesVersion('0.2.9', '^0.2.1'), true);
    assert.equal(satisfiesVersion('0.3.0', '^0.2.1'), false);
    assert.equal(satisfiesVersion('1.2.9', '~1.2.0'), true);
    assert.equal(satisfiesVersion('1.3.0', '~1.2.0'), false);
    assert.equal(satisfiesVersion('1.5.0', '>=1.2.0'), true);
    assert.equal(satisfiesVersion('1.1.0', '>=1.2.0'), false);
    assert.equal(satisfiesVersion('3.1.4', '*'), true);
    assert.equal(satisfiesVersion('1.2.3', '1.2.3'), true);
    assert.equal(satisfiesVersion('1.2.4', '1.2.3'), false);
  });
});

describe('plugin host — manifest integrity & Ed25519 signature', () => {
  it('signs and verifies a manifest with a real keypair', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const base: PluginManifest = { name: 'p', version: '1.0.0', capabilities: ['x'], permissions: ['events'] };
    const signed = signManifest(base, privateKey);
    assert.equal(signed.checksum, manifestChecksum(base));
    assert.equal(verifyManifest(signed, publicKey), true);
  });
  it('rejects a tampered manifest body', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const signed = signManifest({ name: 'p', version: '1.0.0', capabilities: ['a'] }, privateKey);
    const tampered = { ...signed, capabilities: ['a', 'evil'] };
    assert.equal(verifyManifest(tampered, publicKey), false);
  });
  it('rejects a signature from the wrong key', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const { publicKey: otherPub } = generateKeyPairSync('ed25519');
    const signed = signManifest({ name: 'p', version: '1.0.0' }, privateKey);
    assert.equal(verifyManifest(signed, otherPub), false);
  });
});

describe('plugin host — registration & signature enforcement', () => {
  it('rejects a manifest that does not match the plugin identity', () => {
    const host = new PluginHost();
    assert.throws(
      () => host.register(new TestPlugin('a', '1.0.0'), { name: 'a', version: '2.0.0' }),
      /does not match/,
    );
  });
  it('requires a valid signature when the host has a public key', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const host = new PluginHost({ publicKey });
    const plugin = new TestPlugin('signed', '1.0.0');
    assert.throws(() => host.register(plugin, { name: 'signed', version: '1.0.0' }), PluginSignatureError);
    const signed = signManifest({ name: 'signed', version: '1.0.0' }, privateKey);
    host.register(plugin, signed); // valid signature → ok
    assert.equal(host.has('signed'), true);
  });
});

describe('plugin host — permissions', () => {
  it('blocks enabling a plugin that requests an ungranted permission', async () => {
    const host = new PluginHost({ grantedPermissions: ['events'] });
    host.register(new TestPlugin('net-plugin', '1.0.0'), { name: 'net-plugin', version: '1.0.0', permissions: ['net'] });
    await assert.rejects(() => host.enable('net-plugin'), PluginPermissionError);
  });
  it('gates the sandbox: middleware requires the middleware permission', async () => {
    const host = new PluginHost({ grantedPermissions: ['events'] }); // no 'middleware'
    host.register(
      new TestPlugin('mw', '1.0.0', [], /*useMiddleware*/ true),
      { name: 'mw', version: '1.0.0', permissions: ['events'] },
    );
    await assert.rejects(() => host.enable('mw'), PluginPermissionError);
  });
  it('allows middleware when granted and exposes it', async () => {
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(
      new TestPlugin('mw2', '1.0.0', [], true),
      { name: 'mw2', version: '1.0.0', permissions: ['middleware'] },
    );
    await host.enable('mw2');
    assert.equal(host.middlewaresOf('mw2').length, 1);
  });
});

describe('plugin host — dependency & version resolution + lifecycle', () => {
  it('enables dependencies first, in order, and runs onInstall once', async () => {
    const log: string[] = [];
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(new TestPlugin('base', '1.2.0', log), { name: 'base', version: '1.2.0' });
    host.register(new TestPlugin('mid', '1.0.0', log), { name: 'mid', version: '1.0.0', dependencies: { base: '^1.0.0' } });
    host.register(new TestPlugin('top', '1.0.0', log), { name: 'top', version: '1.0.0', dependencies: { mid: '~1.0.0' } });

    await host.enable('top');
    // base before mid before top (install + load ordering)
    assert.deepEqual(log, ['install:base', 'load:base', 'install:mid', 'load:mid', 'install:top', 'load:top']);
    assert.equal(host.state('base'), 'enabled');

    // Re-enabling is idempotent (no second install/load).
    await host.enable('top');
    assert.deepEqual(log.filter((l) => l === 'install:top').length, 1);
  });

  it('rejects a missing dependency', async () => {
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(new TestPlugin('needsx', '1.0.0'), { name: 'needsx', version: '1.0.0', dependencies: { x: '^1.0.0' } });
    await assert.rejects(() => host.enable('needsx'), PluginDependencyError);
  });

  it('rejects a version-incompatible dependency', async () => {
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(new TestPlugin('lib', '2.0.0'), { name: 'lib', version: '2.0.0' });
    host.register(new TestPlugin('app', '1.0.0'), { name: 'app', version: '1.0.0', dependencies: { lib: '^1.0.0' } });
    await assert.rejects(() => host.enable('app'), /requires "lib\^?@?\^1\.0\.0"|requires "lib@\^1\.0\.0"/);
  });

  it('detects circular dependencies', async () => {
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(new TestPlugin('a', '1.0.0'), { name: 'a', version: '1.0.0', dependencies: { b: '*' } });
    host.register(new TestPlugin('b', '1.0.0'), { name: 'b', version: '1.0.0', dependencies: { a: '*' } });
    await assert.rejects(() => host.enable('a'), /Circular/);
  });
});

describe('plugin host — failed-enable rollback', () => {
  // Inspect retained references too: removing the map entry alone must not hide leaks.
  const sandboxesOf = (host: PluginHost) => (host as unknown as {
    sandboxes: Map<string, SandboxedApp & { middlewares: unknown[]; listeners: unknown[] }>;
  }).sandboxes;

  for (const count of [0, 1, 3]) {
    it(`rolls back ${count} resources in reverse order and retries with a fresh sandbox`, async () => {
      const host = new PluginHost({ grantedPermissions: '*' });
      const startup = { reason: 'load failed' };
      const cleaned: number[] = [];
      const attempts: SandboxedApp[] = [];
      let fail = true;
      const plugin = new TestPlugin('rollback', '1.0.0');
      plugin.onLoad = async (app) => {
        attempts.push(app);
        app.use(async (_ctx, next) => { await next(); });
        app.on('ready', () => {});
        for (let i = 0; i < count; i++) app.addCleanup(() => { cleaned.push(i); });
        if (fail) throw startup;
      };
      host.register(plugin, { name: plugin.name, version: plugin.version, permissions: ['middleware', 'events'] });
      await assert.rejects(host.enable(plugin.name), (error) => error === startup);
      assert.deepEqual(cleaned, Array.from({ length: count }, (_, i) => count - 1 - i));
      assert.equal(host.state(plugin.name), 'registered');
      assert.equal(sandboxesOf(host).has(plugin.name), false);
      assert.deepEqual(host.middlewaresOf(plugin.name), []);
      const failed = attempts[0] as SandboxedApp & { middlewares: unknown[]; listeners: unknown[] };
      assert.deepEqual(failed.middlewares, []);
      assert.deepEqual(failed.listeners, []);
      assert.equal(plugin.unloaded, 0);
      fail = false;
      await host.enable(plugin.name);
      assert.notEqual(attempts[0], attempts[1]);
      assert.equal(host.state(plugin.name), 'enabled');
      assert.equal(plugin.installed, 1);
      await host.disable(plugin.name);
      assert.equal(cleaned.length, count * 2);
    });
  }

  it('keeps every cleanup failure individually accessible and still runs the earliest cleanup', async () => {
    const host = new PluginHost({ grantedPermissions: '*' });
    const startup = Symbol('startup');
    const middle = new Error('middle cleanup');
    const latest = { reason: 'latest cleanup' };
    const cleaned: number[] = [];
    const plugin = new TestPlugin('cleanup-errors', '1.0.0');
    let sandbox!: SandboxedApp & { middlewares: unknown[]; listeners: unknown[] };
    plugin.onLoad = async (app) => {
      sandbox = sandboxesOf(host).get(plugin.name)!;
      app.use(async (_ctx, next) => { await next(); });
      app.on('ready', () => {});
      app.addCleanup(() => { cleaned.push(0); });
      app.addCleanup(() => { cleaned.push(1); throw middle; });
      app.addCleanup(() => { cleaned.push(2); throw latest; });
      throw startup;
    };
    host.register(plugin, { name: plugin.name, version: plugin.version, permissions: ['middleware', 'events'] });
    await assert.rejects(host.enable(plugin.name), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, startup);
      assert.deepEqual(error.errors, [startup, latest, middle]);
      return true;
    });
    assert.deepEqual(cleaned, [2, 1, 0]);
    assert.deepEqual(sandbox!.middlewares, []);
    assert.deepEqual(sandbox!.listeners, []);
    assert.equal(sandboxesOf(host).has(plugin.name), false);
    assert.equal(host.state(plugin.name), 'registered');
  });

  it('preserves disabled state after a failed re-enable', async () => {
    const host = new PluginHost();
    const plugin = new TestPlugin('disabled', '1.0.0');
    host.register(plugin, { name: plugin.name, version: plugin.version });
    await host.enable(plugin.name);
    await host.disable(plugin.name);
    let cleaned = 0;
    plugin.onLoad = async (app) => {
      app.addCleanup(() => { cleaned++; });
      throw new Error('re-enable failed');
    };
    await assert.rejects(host.enable(plugin.name), /re-enable failed/);
    assert.equal(cleaned, 1);
    assert.equal(host.state(plugin.name), 'disabled');
    assert.equal(sandboxesOf(host).has(plugin.name), false);
    assert.equal(plugin.unloaded, 1);
    assert.equal(plugin.installed, 1);
  });

  it('does not repeat manually invoked disposers, including a throwing disposer', async () => {
    const host = new PluginHost();
    const plugin = new TestPlugin('manual', '1.0.0');
    let calls = 0;
    let dispose!: () => void;
    const startup = new Error('startup');
    plugin.onLoad = async (app) => {
      dispose = app.addCleanup(() => { calls++; throw new Error('manual cleanup'); });
      assert.throws(dispose, /manual cleanup/);
      dispose();
      app.addCleanup(() => { calls++; });
      throw startup;
    };
    host.register(plugin, { name: plugin.name, version: plugin.version });
    await assert.rejects(host.enable(plugin.name), (error) => error === startup);
    dispose();
    assert.equal(calls, 2);
  });

  it('removes the sandbox after onInstall fails and retries installation', async () => {
    const host = new PluginHost();
    const plugin = new TestPlugin('install-failure', '1.0.0');
    const startup = undefined;
    const attempts: unknown[] = [];
    plugin.onInstall = async () => {
      attempts.push(sandboxesOf(host).get(plugin.name));
      if (attempts.length === 1) throw startup;
    };
    host.register(plugin, { name: plugin.name, version: plugin.version });
    await assert.rejects(host.enable(plugin.name), (error) => error === startup);
    assert.equal(sandboxesOf(host).has(plugin.name), false);
    assert.equal(host.state(plugin.name), 'registered');
    assert.equal(plugin.loaded, 0);
    assert.equal(plugin.unloaded, 0);
    await host.enable(plugin.name);
    assert.equal(attempts.length, 2);
    assert.notEqual(attempts[0], attempts[1]);
    assert.equal(plugin.loaded, 1);
  });

  it('leaves auto-enabled dependencies running without unloading the failed plugin', async () => {
    const host = new PluginHost();
    const dependency = new TestPlugin('dependency', '1.0.0');
    const plugin = new TestPlugin('dependent', '1.0.0');
    plugin.onLoad = async () => { throw new Error('dependent failed'); };
    host.register(dependency, { name: dependency.name, version: dependency.version });
    host.register(plugin, { name: plugin.name, version: plugin.version, dependencies: { dependency: '*' } });
    await assert.rejects(host.enable(plugin.name), /dependent failed/);
    assert.equal(host.state(dependency.name), 'enabled');
    assert.equal(dependency.unloaded, 0);
    assert.equal(plugin.unloaded, 0);
    assert.equal(sandboxesOf(host).has(plugin.name), false);
  });
});

describe('plugin host — discovery & disable/remove safety', () => {
  it('discovers by capability and lists/queries state', async () => {
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(new TestPlugin('pay', '1.0.0'), { name: 'pay', version: '1.0.0', capabilities: ['payments'] });
    host.register(new TestPlugin('mail', '1.0.0'), { name: 'mail', version: '1.0.0', capabilities: ['email'] });
    assert.deepEqual(host.findByCapability('payments'), ['pay']);
    assert.deepEqual(host.list().sort(), ['mail', 'pay']);
  });

  it('refuses to disable a plugin that an enabled plugin depends on, and unloads on disable', async () => {
    const log: string[] = [];
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(new TestPlugin('core-lib', '1.0.0', log), { name: 'core-lib', version: '1.0.0' });
    host.register(new TestPlugin('feature', '1.0.0', log), { name: 'feature', version: '1.0.0', dependencies: { 'core-lib': '*' } });
    await host.enable('feature');

    await assert.rejects(() => host.disable('core-lib'), PluginDependencyError);
    await host.disable('feature');
    assert.equal(host.state('feature'), 'disabled');
    assert.ok(log.includes('unload:feature'));
    await host.disable('core-lib'); // now allowed
    assert.equal(host.state('core-lib'), 'disabled');
  });

  it('refuses to remove an enabled plugin', async () => {
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(new TestPlugin('r', '1.0.0'), { name: 'r', version: '1.0.0' });
    await host.enable('r');
    await assert.rejects(() => host.remove('r'), PluginStateError);
    await host.disable('r');
    await host.remove('r');
    assert.equal(host.has('r'), false);
  });

  it('disposes arbitrary plugin resources on disable', async () => {
    let cleaned = 0;
    class ResourcePlugin extends PluginModule {
      readonly name = 'resource-plugin';
      readonly version = '1.0.0';
      override async onLoad(app: SandboxedApp): Promise<void> {
        app.addCleanup(() => { cleaned++; });
      }
    }
    const host = new PluginHost({ grantedPermissions: '*' });
    host.register(new ResourcePlugin(), { name: 'resource-plugin', version: '1.0.0' });
    await host.enable('resource-plugin');
    await host.disable('resource-plugin');
    await host.disable('resource-plugin');
    assert.equal(cleaned, 1);
  });
});
