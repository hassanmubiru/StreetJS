// src/microservices/transports/rabbitmq.ts
// EventBus RabbitMQ transport entry point.
//
// The production AMQP 0-9-1 implementation lives in
// `packages/core/src/transports/rabbitmq/` (connection management, publisher
// confirms, acknowledging consumer with dead-letter routing + retry, automatic
// reconnect, heartbeats, graceful shutdown). This module re-exports it under
// the microservices transport namespace so it can be used directly as an
// `EventBusTransport` alongside the in-process and Redis transports.
export { RabbitMqTransport, RabbitMqConnectionManager, RabbitMqPublisher, RabbitMqConsumer, AmqpConnection, } from '../../transports/rabbitmq/index.js';
// Alias matching the roadmap naming (`RabbitMQTransport`).
export { RabbitMqTransport as RabbitMQTransport } from '../../transports/rabbitmq/index.js';
//# sourceMappingURL=rabbitmq.js.map