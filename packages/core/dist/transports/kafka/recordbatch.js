// src/transports/kafka/recordbatch.ts
// Kafka RecordBatch v2 (magic byte 2) encoder/decoder. Uncompressed only.
import { KafkaWriter, KafkaReader, crc32c } from './primitives.js';
const MAGIC = 2;
/** Encode a single uncompressed RecordBatch v2 from a list of records. */
export function encodeRecordBatch(records, opts = {}) {
    const firstTimestamp = BigInt(Date.now());
    // Encode records section
    const recW = new KafkaWriter();
    records.forEach((rec, i) => {
        const inner = new KafkaWriter();
        inner.int8(0); // attributes
        inner.varint(0); // timestampDelta
        inner.varint(i); // offsetDelta
        if (rec.key === null)
            inner.varint(-1);
        else {
            inner.varint(rec.key.length);
            inner.raw(rec.key);
        }
        if (rec.value === null)
            inner.varint(-1);
        else {
            inner.varint(rec.value.length);
            inner.raw(rec.value);
        }
        inner.varint(0); // header count
        const body = inner.build();
        recW.varint(body.length); // record length prefix
        recW.raw(body);
    });
    const recordsBuf = recW.build();
    // Body after the CRC field
    const afterCrc = new KafkaWriter();
    afterCrc.int16(0); // attributes (no compression)
    afterCrc.int32(records.length - 1); // lastOffsetDelta
    afterCrc.int64(firstTimestamp); // firstTimestamp
    afterCrc.int64(firstTimestamp); // maxTimestamp
    afterCrc.int64(opts.producerId ?? -1n); // producerId
    afterCrc.int16(opts.producerEpoch ?? -1); // producerEpoch
    afterCrc.int32(opts.baseSequence ?? -1); // baseSequence
    afterCrc.int32(records.length); // record count
    afterCrc.raw(recordsBuf);
    const afterCrcBuf = afterCrc.build();
    const crc = crc32c(afterCrcBuf);
    // Header up to and including CRC
    const head = new KafkaWriter();
    head.int32(-1); // partitionLeaderEpoch
    head.int8(MAGIC); // magic
    head.uint32(crc); // crc32c
    const headBuf = head.build();
    const batchLengthBody = Buffer.concat([headBuf, afterCrcBuf]);
    const full = new KafkaWriter();
    full.int64(0n); // baseOffset
    full.int32(batchLengthBody.length); // batchLength
    full.raw(batchLengthBody);
    return full.build();
}
/** Decode one or more RecordBatch v2 structures from a buffer (as returned by Fetch). */
export function decodeRecordBatches(buf) {
    const records = [];
    let offset = 0;
    while (offset + 12 <= buf.length) {
        const baseOffset = buf.readBigInt64BE(offset);
        const batchLength = buf.readInt32BE(offset + 8);
        const batchEnd = offset + 12 + batchLength;
        if (batchLength <= 0 || batchEnd > buf.length)
            break;
        const batch = buf.subarray(offset + 12, batchEnd);
        // batch layout: partitionLeaderEpoch(4) magic(1) crc(4) attributes(2)
        // lastOffsetDelta(4) firstTs(8) maxTs(8) producerId(8) producerEpoch(2)
        // baseSequence(4) recordCount(4) [records]
        const r = new KafkaReader(batch);
        r.int32(); // partitionLeaderEpoch
        const magic = r.int8();
        r.uint32(); // crc
        r.int16(); // attributes
        r.int32(); // lastOffsetDelta
        const firstTimestamp = r.int64();
        r.int64(); // maxTimestamp
        r.int64(); // producerId
        r.int16(); // producerEpoch
        r.int32(); // baseSequence
        const count = r.int32();
        if (magic !== MAGIC) {
            offset = batchEnd;
            continue;
        }
        for (let i = 0; i < count; i++) {
            r.varint(); // record length (we read fields directly)
            r.int8(); // attributes
            const tsDelta = r.varint();
            const offsetDelta = r.varint();
            const keyLen = Number(r.varint());
            const key = keyLen < 0 ? null : r.remainingBuffer().subarray(0, keyLen);
            if (keyLen >= 0)
                r.skip(keyLen);
            const valLen = Number(r.varint());
            const value = valLen < 0 ? null : r.remainingBuffer().subarray(0, valLen);
            if (valLen >= 0)
                r.skip(valLen);
            const headerCount = Number(r.varint());
            for (let h = 0; h < headerCount; h++) {
                const hkLen = Number(r.varint());
                if (hkLen >= 0)
                    r.skip(hkLen);
                const hvLen = Number(r.varint());
                if (hvLen >= 0)
                    r.skip(hvLen);
            }
            records.push({
                key,
                value,
                offset: baseOffset + offsetDelta,
                timestamp: firstTimestamp + tsDelta,
            });
        }
        offset = batchEnd;
    }
    return records;
}
//# sourceMappingURL=recordbatch.js.map