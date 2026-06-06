// tests/kafka-codec.test.ts
// Broker-independent unit tests for the Kafka wire primitives and the
// RecordBatch v2 encoder/decoder. These verify the most error-prone parts of
// the protocol (zigzag varints, CRC32C, record framing) without a broker.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KafkaWriter, KafkaReader, crc32c } from '../transports/kafka/primitives.js';
import { encodeRecordBatch, decodeRecordBatches } from '../transports/kafka/recordbatch.js';

describe('Kafka primitives', () => {
  it('round-trips fixed-width integers', () => {
    const buf = new KafkaWriter()
      .int8(-5).int16(-1000).int32(123456).uint32(0xdeadbeef).int64(9007199254740993n)
      .build();
    const r = new KafkaReader(buf);
    assert.equal(r.int8(), -5);
    assert.equal(r.int16(), -1000);
    assert.equal(r.int32(), 123456);
    assert.equal(r.uint32(), 0xdeadbeef);
    assert.equal(r.int64(), 9007199254740993n);
  });

  it('round-trips nullable strings and bytes', () => {
    const buf = new KafkaWriter()
      .string('hello').string(null).bytes(Buffer.from([1, 2, 3])).bytes(null)
      .build();
    const r = new KafkaReader(buf);
    assert.equal(r.string(), 'hello');
    assert.equal(r.string(), null);
    assert.deepEqual([...r.bytes()!], [1, 2, 3]);
    assert.equal(r.bytes(), null);
  });

  it('round-trips zigzag varints across sign and magnitude', () => {
    const values = [0n, -1n, 1n, -2n, 2n, 63n, -64n, 127n, -128n, 300n, -300n, 2147483647n, -2147483648n, 9007199254740993n];
    const w = new KafkaWriter();
    for (const v of values) w.varint(v);
    const r = new KafkaReader(w.build());
    for (const v of values) assert.equal(r.varint(), v);
  });

  it('computes the known CRC32C of the ASCII string "123456789"', () => {
    // The canonical CRC-32C check value is 0xE3069283.
    assert.equal(crc32c(Buffer.from('123456789', 'ascii')) >>> 0, 0xe3069283);
  });

  it('CRC32C of empty input is 0', () => {
    assert.equal(crc32c(Buffer.alloc(0)), 0);
  });
});

describe('Kafka RecordBatch v2', () => {
  it('encodes then decodes a batch of records preserving key/value/offset', () => {
    const records = [
      { key: Buffer.from('k0'), value: Buffer.from('v0') },
      { key: null, value: Buffer.from('v1') },
      { key: Buffer.from('k2'), value: null },
    ];
    const encoded = encodeRecordBatch(records);
    const decoded = decodeRecordBatches(encoded);
    assert.equal(decoded.length, 3);
    assert.deepEqual(decoded[0]!.key && [...decoded[0]!.key], [...Buffer.from('k0')]);
    assert.deepEqual(decoded[0]!.value && [...decoded[0]!.value], [...Buffer.from('v0')]);
    assert.equal(decoded[1]!.key, null);
    assert.deepEqual(decoded[1]!.value && [...decoded[1]!.value], [...Buffer.from('v1')]);
    assert.equal(decoded[2]!.value, null);
    assert.equal(decoded[0]!.offset, 0n);
    assert.equal(decoded[1]!.offset, 1n);
    assert.equal(decoded[2]!.offset, 2n);
  });

  it('produces a CRC that validates against its own body', () => {
    const encoded = encodeRecordBatch([{ key: null, value: Buffer.from('check') }]);
    // Layout: baseOffset(8) batchLength(4) partitionLeaderEpoch(4) magic(1) crc(4) ...rest
    const storedCrc = encoded.readUInt32BE(8 + 4 + 4 + 1);
    const afterCrc = encoded.subarray(8 + 4 + 4 + 1 + 4);
    assert.equal(crc32c(afterCrc), storedCrc);
  });

  it('decodes an empty trailing buffer without throwing', () => {
    assert.deepEqual(decodeRecordBatches(Buffer.alloc(0)), []);
    assert.deepEqual(decodeRecordBatches(Buffer.from([0, 0, 0])), []);
  });
});
