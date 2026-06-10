// Runnable example: register the Redis plugin on a PluginHost with enforced
// signature verification, then exercise the pure RESP2 codec offline.
//
//   node example/index.mjs
//
// Enabling the plugin would open a TCP connection to a live Redis server, so
// this example stops at registration and instead demonstrates the dependency-
// free RESP2 encoder/parser, which is pure and needs no network or credentials.

import { generateKeyPairSync } from 'node:crypto';
import { PluginHost, signManifest } from 'streetjs';
import { RedisPlugin, redisPluginManifest, encodeCommand, parseReply } from '@streetjs/plugin-redis';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const host = new PluginHost({
  grantedPermissions: ['net', 'secrets', 'middleware'],
  publicKey,
});

const plugin = new RedisPlugin({ host: '127.0.0.1', port: 6379 });

host.register(plugin, signManifest(redisPluginManifest(), privateKey));
console.log('Redis plugin registered with verified signature:', host.has(plugin.name));

// Pure, offline RESP2 round trip — no server required.
const wire = encodeCommand(['SET', 'greeting', 'hello']);
console.log('Encoded SET command:', JSON.stringify(wire.toString('utf8')));

const reply = parseReply(Buffer.from('+OK\r\n'));
console.log('Parsed reply:', reply?.value);
