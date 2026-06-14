// Runnable example for @streetjs/plugin-nats.
//
// Prereq: a NATS server on 127.0.0.1:4222 (e.g. `docker run -p 4222:4222 nats:latest`).
// Then: node example/index.mjs
//
// Demonstrates connect → subscribe → publish → receive → unsubscribe → close
// using only the dependency-free client shipped by this plugin.

import { NatsClient } from '../dist/index.js';

const client = new NatsClient({ host: '127.0.0.1', port: 4222, name: 'nats-example' });

await client.connect();
console.log('connected to NATS');

const received = new Promise((resolve) => {
  client.subscribe('demo.greeting', (msg) => {
    console.log(`received on ${msg.subject}: ${msg.data.toString('utf8')}`);
    resolve();
  });
});

await client.flush(); // ensure the SUB is registered before publishing
client.publish('demo.greeting', 'hello from StreetJS');
await received;

await client.close();
console.log('done');
