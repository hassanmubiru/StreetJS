// Unit tests for the Supabase plugin's request builders + config validation.
// Pure/offline — no network. Run: npm test -w packages/plugin-supabase

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateSupabaseConfig, buildSelectRequest, buildInsertRequest,
  supabasePluginManifest, SUPABASE_PLUGIN_NAME,
} from '../dist/index.js';

const cfg = { url: 'https://demo.supabase.co', apiKey: 'key123' };

describe('validateSupabaseConfig', () => {
  it('accepts a valid config and strips a trailing slash', () => {
    const c = validateSupabaseConfig({ url: 'https://demo.supabase.co/', apiKey: 'k' });
    assert.equal(c.url, 'https://demo.supabase.co');
  });
  it('rejects a non-https url', () => {
    assert.throws(() => validateSupabaseConfig({ url: 'http://x', apiKey: 'k' }), /"url" is required/);
  });
  it('rejects a missing apiKey', () => {
    assert.throws(() => validateSupabaseConfig({ url: 'https://x.co' }), /"apiKey" is required/);
  });
});

describe('buildSelectRequest', () => {
  it('targets /rest/v1/<table> with select and apikey headers', () => {
    const req = buildSelectRequest(cfg, 'profiles', { columns: 'id,username', filters: { id: 'eq.42' }, limit: 1 });
    assert.equal(req.method, 'GET');
    assert.match(req.url, /\/rest\/v1\/profiles\?/);
    assert.match(req.url, /select=id%2Cusername/);
    assert.match(req.url, /id=eq\.42/);
    assert.match(req.url, /limit=1/);
    assert.equal(req.headers.apikey, 'key123');
    assert.equal(req.headers.authorization, 'Bearer key123');
  });
  it('rejects an invalid table name', () => {
    assert.throws(() => buildSelectRequest(cfg, 'bad table'), /invalid table/);
  });
});

describe('buildInsertRequest', () => {
  it('POSTs JSON with return=representation', () => {
    const req = buildInsertRequest(cfg, 'events', { kind: 'signup' });
    assert.equal(req.method, 'POST');
    assert.match(req.url, /\/rest\/v1\/events$/);
    assert.equal(req.headers.prefer, 'return=representation');
    assert.equal(JSON.parse(req.body).kind, 'signup');
  });
});

describe('manifest', () => {
  it('declares name, capabilities, permissions', () => {
    const m = supabasePluginManifest();
    assert.equal(m.name, SUPABASE_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['database', 'postgrest', 'supabase']);
    assert.deepEqual(m.permissions, ['net', 'secrets', 'middleware']);
  });
});
