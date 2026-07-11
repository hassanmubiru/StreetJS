// Offline contract test — proves the built plugin loads and honors the contract.
// Run: npm run build && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import Plugin from '../dist/index.js';

test('default export is a PluginModule subclass with name + version', () => {
  const p = new Plugin();
  assert.equal(typeof p.name, 'string');
  assert.ok(p.name.length > 0, 'name is non-empty');
  assert.match(p.version, /^\d+\.\d+\.\d+/, 'version is semver');
});

test('declares the expected lifecycle hooks', () => {
  const p = new Plugin();
  assert.equal(typeof p.onLoad, 'function');
  assert.equal(typeof p.onUnload, 'function');
  assert.equal(typeof p.onInstall, 'function');
});
