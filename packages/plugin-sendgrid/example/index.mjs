// Runnable example: register the SendGrid plugin on a PluginHost with enforced
// signature verification, then build (offline) a SendGrid mail/send request.
//
//   node example/index.mjs
//
// No network call and no real credentials are needed — buildMailSendRequest is
// pure, so this demonstrates the plugin end-to-end offline.

import { generateKeyPairSync } from 'node:crypto';
import { PluginHost, signManifest, SendGridClient } from 'streetjs';
import SendGridPlugin, { sendGridPluginManifest } from '@streetjs/plugin-sendgrid';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new SendGridPlugin({
  apiKey: 'SG.test-key',
  defaultFrom: 'no-reply@example.com',
});

host.register(plugin, signManifest(sendGridPluginManifest(), privateKey));
await host.enable(plugin.name);
console.log('SendGrid plugin enabled:', host.has(plugin.name));

const client = new SendGridClient({ apiKey: 'SG.test-key', defaultFrom: 'no-reply@example.com' });
const req = client.buildMailSendRequest({ to: 'a@b.com', subject: 'Hi', text: 'Hello from street' });
console.log('Request:', req.method, req.url);
console.log('Body:', req.body);
