export declare const FRAME_METHOD = 1;
export declare const FRAME_HEADER = 2;
export declare const FRAME_BODY = 3;
export declare const FRAME_HEARTBEAT = 8;
export declare const FRAME_END = 206;
export interface RawFrame {
    type: number;
    channel: number;
    payload: Buffer;
}
/** The AMQP protocol header sent first on a new connection. */
export declare const PROTOCOL_HEADER: Buffer<ArrayBuffer>;
export declare class AmqpWriter {
    private chunks;
    octet(v: number): this;
    shortUint(v: number): this;
    longUint(v: number): this;
    longLong(v: bigint): this;
    shortStr(s: string): this;
    longStr(s: string | Buffer): this;
    /** Encode an AMQP field table from a plain object (string/number/bool values). */
    table(obj: Record<string, unknown>): this;
    private _field;
    /** Pack a list of booleans into AMQP bit octets (LSB first). */
    bits(...flags: boolean[]): this;
    build(): Buffer;
}
export declare class AmqpReader {
    private readonly buf;
    private offset;
    constructor(buf: Buffer);
    octet(): number;
    shortUint(): number;
    longUint(): number;
    longLong(): bigint;
    shortStr(): string;
    longStr(): Buffer;
    /** Skip a field table (we rarely need to read server tables). */
    skipTable(): void;
    bit(): boolean;
    get remaining(): Buffer;
}
/** Wrap a payload in an AMQP frame: [type][channel][size][payload][0xCE]. */
export declare function buildFrame(type: number, channel: number, payload: Buffer): Buffer;
/** Build a METHOD frame: payload = [class-id][method-id][args]. */
export declare function buildMethodFrame(channel: number, classId: number, methodId: number, args: Buffer): Buffer;
/** Build a content HEADER frame for Basic.Publish. */
export declare function buildHeaderFrame(channel: number, classId: number, bodySize: number, properties?: Record<string, unknown>): Buffer;
/** Build a BODY frame. */
export declare function buildBodyFrame(channel: number, body: Buffer): Buffer;
/** Build a HEARTBEAT frame (channel 0, empty payload). */
export declare function buildHeartbeat(): Buffer;
/** Accumulates socket bytes and yields complete frames. */
export declare class FrameDecoder {
    private buf;
    push(chunk: Buffer): void;
    next(): RawFrame | null;
}
/** Parse the class-id/method-id prefix of a METHOD frame payload. */
export declare function readMethodHeader(payload: Buffer): {
    classId: number;
    methodId: number;
    reader: AmqpReader;
};
//# sourceMappingURL=codec.d.ts.map