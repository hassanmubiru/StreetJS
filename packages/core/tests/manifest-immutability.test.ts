import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  PluginHost,
  type PluginManifest,
  type PluginPermission,
} from '../src/platform/plugins/host.js';
import { PluginModule, type SandboxedApp } from '../src/platform/plugins/sdk.js';

// Feature: security-hardening, Property 5: The registered manifest is immutable across the lifecycle
//
// For any valid manifest, after registration the host's stored manifest SHALL be a
// deep-frozen copy distinct from the caller's reference, such that any mutation
// applied to the original manifest object after registration leaves the host's
// permission and dependency decisions and the value returned by `manifestOf`
// unchanged.
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4

// ---- recognized permission values -------------------------------------------

const PERMISSION_VALUES = ['middleware', 'events', 'net', 'fs', 'db', 'secrets'] as const;

// ---- helpers ----------------------------------------------------------------

/**
 * Minimal concrete plugin. `PluginModule` is abstract (only `name`/`version` are
 * required), so a tiny subclass is the lightest faithful test double.
 */
class TestPlugin extends PluginModule {
  constructor(readonly name: string, readonly version: string) {
    super();
  }
  async onLoad(_app: SandboxedApp): Promise<void> {
    /* no-op */
  }
}

/**
 * Per-run unique id so plugin/dependency names never collide within a host and
 * so each run is independent (fresh host per run anyway).
 */
let seq = 0;

/** The set of post-register mutations applied to the ORIGINAL manifest. */
type Mutation = 'push-perm' | 'change-version' | 'add-dep' | 'remove-dep' | 'reassign-name';

// ---- generators -------------------------------------------------------------

const configArb = fc.record({
  // Random subset of the recognized permissions (the frozen permission set).
  permissions: fc.subarray([...PERMISSION_VALUES]),
  // Random number of (real, registered) dependencies.
  depCount: fc.integer({ min: 0, max: 3 }),
  capabilities: fc.array(fc.string({ maxLength: 8 }), { maxLength: 3 }),
  version: fc.constantFrom('1.0.0', '1.2.3', '2.0.0', '0.9.1', '3.4.5'),
  mutation: fc.constantFrom<Mutation>(
    'push-perm',
    'change-version',
    'add-dep',
    'remove-dep',
    'reassign-name',
  ),
});

// ---- property ---------------------------------------------------------------

describe('Property 5: the registered manifest is immutable across the lifecycle', () => {
  it('stores a distinct deep-frozen copy whose decisions and manifestOf are unaffected by mutating the original', async () => {
    await fc.assert(
      fc.asyncProperty(configArb, async (cfg) => {
        const id = seq++;
        const mainName = `plugin_${id}`;

        // Grant EXACTLY the manifest's permission set so the frozen permissions are
        // all granted (enable succeeds on the frozen copy) while any later-added
        // permission is, by construction, ungranted — exposing any read-through to
        // the mutated original as a PluginPermissionError.
        const host = new PluginHost({ grantedPermissions: cfg.permissions });

        // Register the real dependency plugins first so the frozen manifest's deps
        // resolve at enable time (range '*' is satisfied by any version).
        const dependencies: Record<string, string> = {};
        for (let i = 0; i < cfg.depCount; i++) {
          const depName = `dep_${id}_${i}`;
          dependencies[depName] = '*';
          host.register(new TestPlugin(depName, '1.0.0'), { name: depName, version: '1.0.0' });
        }

        // The caller-supplied (mutable) manifest reference.
        const original: PluginManifest = {
          name: mainName,
          version: cfg.version,
          capabilities: [...cfg.capabilities],
          permissions: [...cfg.permissions],
          dependencies: { ...dependencies },
        };

        host.register(new TestPlugin(mainName, cfg.version), original);

        const stored = host.manifestOf(mainName);
        assert.ok(stored, 'manifest should be stored after registration');

        // (Req 6.1, 6.4) A DISTINCT object from the caller's reference.
        assert.notEqual(stored, original, 'stored manifest must not be the caller reference');

        // (Req 6.1) Deep-frozen at the top level AND for nested objects/arrays.
        assert.ok(Object.isFrozen(stored), 'stored manifest must be frozen');
        assert.ok(Object.isFrozen(stored.permissions), 'permissions array must be frozen');
        assert.ok(Object.isFrozen(stored.dependencies), 'dependencies object must be frozen');
        assert.ok(Object.isFrozen(stored.capabilities), 'capabilities array must be frozen');

        // Snapshot the frozen copy immediately after registration.
        const snapshot = structuredClone(stored) as PluginManifest;

        // (Req 6.3) Apply a random structural mutation to the ORIGINAL.
        switch (cfg.mutation) {
          case 'push-perm':
            original.permissions!.push('secrets');
            break;
          case 'change-version':
            original.version = '9.9.9';
            break;
          case 'add-dep':
            original.dependencies!['ghost-extra'] = '^1.0.0';
            break;
          case 'remove-dep':
            for (const k of Object.keys(original.dependencies!)) delete original.dependencies![k];
            break;
          case 'reassign-name':
            original.name = 'totally-different';
            break;
        }

        // Always also introduce decision-relevant mutations to the ORIGINAL:
        //  - a dependency on a MISSING plugin (would make enable throw if read), and
        //  - an UNGRANTED permission (would make enable throw if read).
        original.dependencies!['ghost-missing'] = '^1.0.0';
        const ungranted = PERMISSION_VALUES.find((p) => !cfg.permissions.includes(p));
        if (ungranted) original.permissions!.push(ungranted as PluginPermission);

        // (Req 6.4) manifestOf is unchanged by the mutation and still frozen.
        assert.deepEqual(host.manifestOf(mainName), snapshot, 'manifestOf must be unchanged');
        assert.ok(Object.isFrozen(host.manifestOf(mainName)), 'manifestOf must remain frozen');

        // (Req 6.2, 6.3) Lifecycle decisions read the frozen copy: enable SUCCEEDS
        // despite the inert ungranted-permission and missing-dependency mutations.
        await host.enable(mainName);
        assert.equal(host.state(mainName), 'enabled', 'enable should succeed via the frozen copy');

        // The stored manifest is STILL the unchanged frozen snapshot after enable.
        assert.deepEqual(host.manifestOf(mainName), snapshot, 'manifestOf unchanged after enable');
      }),
      { numRuns: 200 },
    );
  });
});
