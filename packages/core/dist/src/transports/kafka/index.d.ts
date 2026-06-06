import { KafkaClient, type KafkaClientOptions, type KafkaRecord } from './client.js';
import type { StreamTransport } from '../../platform/event-streaming.js';
export { KafkaClient, KafkaProtocolError } from './client.js';
export type { KafkaClientOptions, ClusterMeta, TopicMeta, PartitionMeta, KafkaRecord } from './client.js';
export { encodeRecordBatch, decodeRecordBatches } from './recordbatch.js';
export interface ProducerOptions {
    batchSize?: number;
    lingerMs?: number;
    acks?: number;
}
export declare class KafkaProducer {
    private readonly client;
    private readonly batches;
    private readonly rr;
    private readonly batchSize;
    private readonly lingerMs;
    private readonly acks;
    private flushTimer;
    private closed;
    constructor(client: KafkaClient, opts?: ProducerOptions);
    private _partitionCount;
    /** Queue a record; resolves once its batch is acknowledged by the broker. */
    send(topic: string, record: KafkaRecord, partition?: number): Promise<void>;
    private _flushTopic;
    /** Flush all buffered records. */
    flush(): Promise<void>;
    /** Flush remaining records and stop. */
    close(): Promise<void>;
}
export interface ConsumerOptions {
    groupId: string;
    topic: string;
    /** Explicit partition assignment. When omitted, all partitions are assigned. */
    partitions?: number[];
    /** Start at the earliest offset when no committed offset exists. Default true. */
    fromBeginning?: boolean;
    /** Poll wait time per fetch. Default 1000ms. */
    pollWaitMs?: number;
    /** Commit committed offset after each processed batch. Default true. */
    autoCommit?: boolean;
}
export interface ConsumedMessage {
    topic: string;
    partition: number;
    offset: bigint;
    key: Buffer | null;
    value: Buffer | null;
}
export declare class KafkaConsumer {
    private readonly client;
    private readonly opts;
    private running;
    private readonly offsets;
    constructor(client: KafkaClient, opts: ConsumerOptions);
    private _assignedPartitions;
    private _startOffset;
    /** Begin the poll loop. Returns once the consumer is initialised. */
    run(handler: (msg: ConsumedMessage) => Promise<void>): Promise<void>;
    /** Manually commit the current next-offset for a partition. */
    commit(partition: number): Promise<void>;
    /** Graceful shutdown: stop polling. */
    stop(): Promise<void>;
}
export declare class KafkaStreamTransport implements StreamTransport {
    private readonly client;
    private readonly producer;
    private readonly consumers;
    constructor(opts?: KafkaClientOptions);
    publish(topic: string, payload: unknown): Promise<void>;
    subscribe(topic: string, groupId: string, handler: (msg: unknown) => Promise<void>): () => void;
    close(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map