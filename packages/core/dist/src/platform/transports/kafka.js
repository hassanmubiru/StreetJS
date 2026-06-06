// src/platform/transports/kafka.ts
// Event-streaming Kafka transport entry point.
//
// The production Kafka binary-protocol implementation lives in
// `packages/core/src/transports/kafka/` (metadata discovery, producer with
// batching + idempotent sequencing, consumer with static partition assignment
// and group offset commit, RecordBatch v2 codec, CRC32C). This module re-exports
// the `StreamTransport` adapter under the platform transport namespace so it can
// be used directly with `EventStreamPublisher` / `EventStreamConsumer` alongside
// the in-process and Kinesis transports.
export { KafkaStreamTransport, KafkaProducer, KafkaConsumer, KafkaClient, KafkaProtocolError, encodeRecordBatch, decodeRecordBatches, } from '../../transports/kafka/index.js';
// Alias matching the roadmap naming (`KafkaTransport`).
export { KafkaStreamTransport as KafkaTransport } from '../../transports/kafka/index.js';
//# sourceMappingURL=kafka.js.map