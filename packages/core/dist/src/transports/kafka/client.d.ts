import { type KafkaBroker, type KafkaConnectionOptions } from './connection.js';
import { encodeRecordBatch, decodeRecordBatches, type KafkaRecord } from './recordbatch.js';
export interface PartitionMeta {
    error: number;
    partition: number;
    leader: number;
    replicas: number[];
    isr: number[];
}
export interface TopicMeta {
    error: number;
    name: string;
    partitions: PartitionMeta[];
}
export interface ClusterMeta {
    brokers: KafkaBroker[];
    controllerId: number;
    topics: TopicMeta[];
}
export interface KafkaClientOptions extends KafkaConnectionOptions {
    brokers?: string[];
}
export declare class KafkaProtocolError extends Error {
    readonly code: number;
    constructor(code: number, op: string);
}
export declare class KafkaClient {
    private readonly bootstrap;
    private readonly clientId;
    private readonly connTimeout;
    private readonly connections;
    private meta;
    constructor(opts?: KafkaClientOptions);
    private _conn;
    private _anyConn;
    /** Metadata v1: brokers (with rack), controller id, topics with partitions. */
    metadata(topics: string[]): Promise<ClusterMeta>;
    private _brokerById;
    /** Resolve the leader broker for a topic-partition. */
    leaderFor(topic: string, partition: number): Promise<KafkaBroker>;
    /** Produce records to a topic-partition (acks=all). Returns base offset. */
    produce(topic: string, partition: number, records: KafkaRecord[], opts?: {
        acks?: number;
        timeoutMs?: number;
    }): Promise<bigint>;
    /** Fetch records from a topic-partition starting at `fetchOffset`. */
    fetch(topic: string, partition: number, fetchOffset: bigint, opts?: {
        maxWaitMs?: number;
        maxBytes?: number;
    }): Promise<{
        records: KafkaRecord[];
        highWatermark: bigint;
    }>;
    /** List offsets: timestamp -1 = latest (end), -2 = earliest (start). */
    listOffset(topic: string, partition: number, timestamp: bigint): Promise<bigint>;
    /** Find the group coordinator broker for a consumer group. */
    findCoordinator(groupId: string): Promise<KafkaBroker>;
    /** Commit an offset for a consumer group (group offset storage). */
    commitOffset(groupId: string, topic: string, partition: number, offset: bigint): Promise<void>;
    /** Fetch the committed offset for a consumer group (-1 if none). */
    fetchOffset(groupId: string, topic: string, partition: number): Promise<bigint>;
    close(): void;
}
export { encodeRecordBatch, decodeRecordBatches };
export type { KafkaRecord };
//# sourceMappingURL=client.d.ts.map