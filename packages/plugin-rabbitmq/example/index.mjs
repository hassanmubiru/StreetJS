// Runnable example for @streetjs/plugin-rabbitmq.
//
// Prereq: a RabbitMQ broker on 127.0.0.1:5672 (e.g. `docker run -p 5672:5672 rabbitmq:3`).
// Then: node example/index.mjs
//
// Demonstrates publish → consume → receive → close using the dependency-free
// AMQP transport this plugin wraps.

import { RabbitMqPlugin } from '../dist/index.js';

// Construct the plugin's client directly for the example.
const plugin = new RabbitMqPlugin({ host: '127.0.0.1', port: 5672, username: 'guest', password: 'guest' });
await plugin.onInstall();
// onLoad normally runs inside the plugin host; here we drive the client via a stub app.
const stub = { use() {} };
await plugin.onLoad(stub);
const mq = plugin.messaging;

const received = new Promise((resolve) => {
  void mq.consume('demo-workers', ['demo.greeting'], async (msg) => {
    console.log('received:', msg.body.toString('utf8'));
    resolve();
  });
});

// Give the consumer a moment to bind, then publish.
setTimeout(() => { void mq.publish('demo.greeting', 'hello from StreetJS'); }, 500);
await received;

await plugin.onUnload();
console.log('done');
