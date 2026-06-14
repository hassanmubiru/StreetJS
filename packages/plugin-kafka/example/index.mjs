// Runnable example for @streetjs/plugin-kafka.
//
// Prereq: a Kafka broker on 127.0.0.1:9092.
// Then: node example/index.mjs
//
// Demonstrates publish → subscribe → receive → close using the dependency-free
// KafkaStreamTransport that this plugin wraps.

import { KafkaStreamTransport } from 'streetjs';

const kafka = new KafkaStreamTransport({ brokers: ['127.0.0.1:9092'], clientId: 'kafka-example' });

const received = new Promise((resolve) => {
  const unsubscribe = kafka.subscribe('demo.greeting', 'example-group', async (msg) => {
    console.log('received:', msg);
    unsubscribe();
    resolve();
  });
});

await kafka.publish('demo.greeting', { hello: 'from StreetJS' });
await received;

await kafka.close();
console.log('done');
