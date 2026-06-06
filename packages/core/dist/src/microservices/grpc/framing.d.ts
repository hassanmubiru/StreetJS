export declare const GRPC_MAX_MESSAGE_BYTES: number;
/** Encode a single payload buffer into a gRPC length-prefixed frame. */
export declare function encodeFrame(payload: Buffer): Buffer;
export interface DecodedFrame {
    payload: Buffer;
    /** Number of bytes consumed from the input. */
    consumed: number;
}
/**
 * Decode the first complete gRPC frame from `buf`, or null if incomplete.
 * Throws if the declared length exceeds `maxBytes` (RESOURCE_EXHAUSTED).
 */
export declare function decodeFrame(buf: Buffer, maxBytes?: number): DecodedFrame | null;
/** Decode all complete frames available in `buf`; returns frames + leftover. */
export declare function decodeFrames(buf: Buffer, maxBytes?: number): {
    frames: Buffer[];
    rest: Buffer;
};
export declare const GRPC_STATUS: {
    readonly OK: 0;
    readonly CANCELLED: 1;
    readonly DEADLINE_EXCEEDED: 4;
    readonly NOT_FOUND: 5;
    readonly RESOURCE_EXHAUSTED: 8;
    readonly INTERNAL: 13;
};
export type GrpcStatusName = keyof typeof GRPC_STATUS;
export declare class GrpcError extends Error {
    readonly code: number;
    constructor(status: GrpcStatusName, message: string);
}
/** Default JSON codec used to (de)serialize message payloads. */
export declare const jsonCodec: {
    encode(value: unknown): Buffer;
    decode<T = unknown>(buf: Buffer): T;
};
/** Parse a gRPC `grpc-timeout` header (e.g. "100m", "1S") into milliseconds. */
export declare function parseGrpcTimeout(value: string | undefined): number | null;
//# sourceMappingURL=framing.d.ts.map