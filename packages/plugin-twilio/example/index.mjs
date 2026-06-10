// Runnable example: register the Twilio plugin on a PluginHost with enforced
// signature verification, then build (offline) a Twilio send request.
//
//   node example/index.mjs
//
// No network call and no real credentials are needed — buildSendSmsRequest is
// pure, so this demonstrates the plugin end-to-end offline.

import { generateKeyPairSync } from 'node:crypto';
import { PluginHost, signManifest, TwilioClient } from 'streetjs';
import TwilioPlugin, { twilioPluginManifest } from '@streetjs/plugin-twilio';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new TwilioPlugin({
  accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  authToken: 'test-token',
  defaultFrom: '+15555550100',
});

host.register(plugin, signManifest(twilioPluginManifest(), privateKey));
await host.enable(plugin.name);
console.log('Twilio plugin enabled:', host.has(plugin.name));

// Show the deterministic, offline request the client would send.
const client = new TwilioClient({
  accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  authToken: 'test-token',
  defaultFrom: '+15555550100',
});
const req = client.buildSendSmsRequest({ to: '+15555550111', body: 'hello from street' });
console.log('Request:', req.method, req.url);
console.log('Body:', req.body);
