// Runnable example: register and enable the S3 plugin on a PluginHost with
// enforced signature verification, then compute deterministic SigV4 headers
// for an object request — all offline.
//
//   node example/index.mjs
//
// signedObjectHeaders is pure (same inputs → same signature) and performs no
// network call, so this demonstrates the plugin end-to-end without credentials
// that resolve to real AWS resources.

import { generateKeyPairSync } from 'node:crypto';
import { PluginHost, signManifest } from 'streetjs';
import S3Plugin, { s3PluginManifest } from '@streetjs/plugin-s3';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new S3Plugin({
  bucket: 'example-bucket',
  region: 'us-east-1',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secretExampleKey',
});

host.register(plugin, signManifest(s3PluginManifest(), privateKey));
await host.enable(plugin.name);
console.log('S3 plugin enabled:', host.has(plugin.name));

const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const headers = plugin.signedObjectHeaders('GET', 'reports/q1.csv', emptyHash, new Date('2025-01-01T00:00:00.000Z'));
console.log('Authorization:', headers['authorization']);
