// src/transports/kafka/primitives.ts
// Kafka protocol wire primitives: a growable big-endian writer/reader,
// signed varints (zigzag), and CRC32C (Castagnoli) used by RecordBatch v2.

export class KafkaWriter {
  private chunks: Buffer[] = [];

  int8(v: number): this { const b = Buffer.alloc(1); b.writeInt8(v, 0); this.chunks.push(b); return this; }
  int16(v: number): this { const b = Buffer.alloc(2); b.writeInt16BE(v, 0); this.chunks.push(b); return this; }
  int32(v: number): this { const b = Buffer.alloc(4); b.writeInt32BE(v, 0); this.chunks.push(b); return this; }
  uint32(v: number): this { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); this.chunks.push(b); return this; }
  int64(v: bigint): this { const b = Buffer.alloc(8); b.writeBigInt64BE(v, 0); this.chunks.push(b); return this; }

  /** Nullable string: INT16 length (-1 for null) + UTF-8 bytes. */
  string(s: string | null): this {
    if (s === null) return this.int16(-1);
    const buf = Buffer.from(s, 'utf8');
    this.int16(buf.length);
    this.chunks.push(buf);
    return this;
  }

  /** Nullable bytes: INT32 length (-1 for null) + raw bytes. */
  bytes(b: Buffer | null): this {
    if (b === null) return this.int32(-1);
    this.int32(b.length);
    this.chunks.push(b);
    return this;
  }

  /** Signed zigzag varint (used inside RecordBatch records). */
  varint(value: number | bigint): this {
    let v = BigInt(value);
    // zigzag encode
    v = (v << 1n) ^ (v >> 63n);
    let zz = BigInt.asUintN(64, v);
    const out: number[] = [];
    do {
      let b = Number(zz & 0x7fn);
      zz >>= 7n;
      if (zz !== 0n) b |= 0x80;
      out.push(b);
    } while (zz !== 0n);
    this.chunks.push(Buffer.from(out));
    return this;
  }

  raw(b: Buffer): this { this.chunks.push(b); return this; }

  build(): Buffer { return Buffer.concat(this.chunks); }
  get length(): number { return this.chunks.reduce((n, c) => n + c.length, 0); }
}

export class KafkaReader {
  private off = 0;
  constructor(private readonly buf: Buffer) {}

  int8(): number { const v = this.buf.readInt8(this.off); this.off += 1; return v; }
  int16(): number { const v = this.buf.readInt16BE(this.off); this.off += 2; return v; }
  int32(): number { const v = this.buf.readInt32BE(this.off); this.off += 4; return v; }
  uint32(): number { const v = this.buf.readUInt32BE(this.off); this.off += 4; return v; }
  int64(): bigint { const v = this.buf.readBigInt64BE(this.off); this.off += 8; return v; }

  string(): string | null {
    const len = this.int16();
    if (len === -1) return null;
    const s = this.buf.toString('utf8', this.off, this.off + len);
    this.off += len;
    return s;
  }

  bytes(): Buffer | null {
    const len = this.int32();
    if (len === -1) return null;
    const b = this.buf.subarray(this.off, this.off + len);
    this.off += len;
    return b;
  }

  varint(): bigint {
    let shift = 0n;
    let result = 0n;
    for (;;) {
      const b = BigInt(this.buf.readUInt8(this.off++));
      result |= (b & 0x7fn) << shift;
      if ((b & 0x80n) === 0n) break;
      shift += 7n;
    }
    // zigzag decode
    return (result >> 1n) ^ -(result & 1n);
  }

  /** Read an array using a per-element reader; INT32 count prefix. */
  array<T>(read: (r: KafkaReader) => T): T[] {
    const count = this.int32();
    if (count < 0) return [];
    const out: T[] = [];
    for (let i = 0; i < count; i++) out.push(read(this));
    return out;
  }

  remainingBuffer(): Buffer { return this.buf.subarray(this.off); }
  skip(n: number): void { this.off += n; }
  get offset(): number { return this.off; }
  get hasMore(): boolean { return this.off < this.buf.length; }
}
