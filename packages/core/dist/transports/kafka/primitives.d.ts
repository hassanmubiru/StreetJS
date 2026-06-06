export declare class KafkaWriter {
    private chunks;
    int8(v: number): this;
    int16(v: number): this;
    int32(v: number): this;
    uint32(v: number): this;
    int64(v: bigint): this;
    /** Nullable string: INT16 length (-1 for null) + UTF-8 bytes. */
    string(s: string | null): this;
    /** Nullable bytes: INT32 length (-1 for null) + raw bytes. */
    bytes(b: Buffer | null): this;
    /** Signed zigzag varint (used inside RecordBatch records). */
    varint(value: number | bigint): this;
    raw(b: Buffer): this;
    build(): Buffer;
    get length(): number;
}
export declare class KafkaReader {
    private readonly buf;
    private off;
    constructor(buf: Buffer);
    int8(): number;
    int16(): number;
    int32(): number;
    uint32(): number;
    int64(): bigint;
    string(): string | null;
    bytes(): Buffer | null;
    varint(): bigint;
    /** Read an array using a per-element reader; INT32 count prefix. */
    array<T>(read: (r: KafkaReader) => T): T[];
    remainingBuffer(): Buffer;
    skip(n: number): void;
    get offset(): number;
    get hasMore(): boolean;
}
/** Compute CRC32C of a buffer. Returns an unsigned 32-bit value. */
export declare function crc32c(buf: Buffer): number;
//# sourceMappingURL=primitives.d.ts.map