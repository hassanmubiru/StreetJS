export interface KafkaRecord {
    key: Buffer | null;
    value: Buffer | null;
    offset?: bigint;
    timestamp?: bigint;
}
/** Encode a single uncompressed RecordBatch v2 from a list of records. */
export declare function encodeRecordBatch(records: KafkaRecord[], opts?: {
    producerId?: bigint;
    producerEpoch?: number;
    baseSequence?: number;
}): Buffer;
/** Decode one or more RecordBatch v2 structures from a buffer (as returned by Fetch). */
export declare function decodeRecordBatches(buf: Buffer): KafkaRecord[];
//# sourceMappingURL=recordbatch.d.ts.map