// Runnable example: register the Auth0 plugin on a PluginHost with enforced
// signature verification, then build (offline) an OAuth2 token request.
//
//   node example/index.mjs
//
// No network call and no real credentials are needed — buildTokenRequest is
// pure, so this demonstrates the plugin end-to-end offline.

import { generateKeyPairSync } from 'node:crypto';
import { PluginHost, signManifest, Auth0Client } from 'streetjs';
import Auth0Plugin, { auth0PluginManifest } from '@streetjs/plugin-auth0';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new Auth0Plugin({
  domain: 'example.us.auth0.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  audience: 'https://api.example.com',
});

host.register(plugin, signManifest(auth0PluginManifest(), privateKey));
await host.enable(plugin.name);
console.log('Auth0 plugin enabled:', host.has(plugin.name));

const client = new Auth0Client({
  domain: 'example.us.auth0.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  audience: 'https://api.example.com',
});
const req = client.buildTokenRequest();
console.log('Request:', req.method, req.url);
console.log('Body:', req.body);
