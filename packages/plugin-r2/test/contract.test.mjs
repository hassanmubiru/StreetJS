// Offline contract test for this official @streetjs plugin.
// Verifies the published surface loads and behaves without any network:
//   - the package imports and exposes a plugin class (default export),
//   - a `manifest` object with a non-empty name + version,
//   - a `*PluginManifest()` factory whose output matches the NAME/VERSION consts,
//   - a `validate*Config` guard that REJECTS invalid input (null and {}).
// Export identifiers are resolved by pattern so this same test is valid for
// every HTTP plugin. Run via the central offline harness or `npm test -w <pkg>`.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../dist/index.js';

const findFn = (re) => Object.entries(mod).find(([k, v]) => re.test(k) && typeof v === 'function')?.[1];
const findVal = (re) => Object.entries(mod).find(([k]) => re.test(k))?.[1];

test('exposes a plugin class as the default export', () => {
  assert.equal(typeof mod.default, 'function', 'default export should be the plugin class');
});

test('exposes a manifest with a non-empty name and version', () => {
  assert.ok(mod.manifest && typeof mod.manifest === 'object', 'manifest object present');
  assert.equal(typeof mod.manifest.name, 'string');
  assert.ok(mod.manifest.name.length > 0, 'manifest.name non-empty');
  assert.equal(typeof mod.manifest.version, 'string');
  assert.ok(mod.manifest.version.length > 0, 'manifest.version non-empty');
});

test('*PluginManifest() factory matches the NAME/VERSION constants', () => {
  const manifestFn = findFn(/PluginManifest$/);
  assert.ok(manifestFn, 'a *PluginManifest factory is exported');
  const m = manifestFn();
  const NAME = findVal(/_PLUGIN_NAME$/);
  const VERSION = findVal(/_PLUGIN_VERSION$/);
  assert.equal(m.name, NAME, 'factory name matches NAME const');
  assert.equal(m.version, VERSION, 'factory version matches VERSION const');
  assert.equal(m.name, mod.manifest.name, 'factory name matches exported manifest');
});

test('validate*Config rejects invalid input (null and {})', () => {
  const validate = findFn(/^validate.*Config$/);
  assert.ok(validate, 'a validate*Config guard is exported');
  assert.throws(() => validate(null), 'null config must throw');
  assert.throws(() => validate({}), 'empty config (missing required fields) must throw');
});
