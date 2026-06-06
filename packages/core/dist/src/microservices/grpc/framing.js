// src/microservices/grpc/framing.ts
// gRPC length-prefixed message framing: [1-byte compressed flag][4-byte BE length][payload].
// The payload codec is pluggable; the default is JSON (self-consistent codec).
export const GRPC_MAX_MESSAGE_BYTES = 4 * 1024 * 1024; // 4 MB default
/** Encode a single payload buffer into a gRPC length-prefixed frame. */
export function encodeFrame(payload) {
    const header = Buffer.alloc(5);
    header.writeUInt8(0, 0); // not compressed
    header.writeUInt32BE(payload.length, 1);
    return Buffer.concat([header, payload]);
}
/**
 * Decode the first complete gRPC frame from `buf`, or null if incomplete.
 * Throws if the declared length exceeds `maxBytes` (RESOURCE_EXHAUSTED).
 */
export function decodeFrame(buf, maxBytes = GRPC_MAX_MESSAGE_BYTES) {
    if (buf.length < 5)
        return null;
    const length = buf.readUInt32BE(1);
    if (length > maxBytes) {
        throw new GrpcError('RESOURCE_EXHAUSTED', `message length ${length} exceeds limit ${maxBytes}`);
    }
    if (buf.length < 5 + length)
        return null;
    return { payload: buf.subarray(5, 5 + length), consumed: 5 + length };
}
/** Decode all complete frames available in `buf`; returns frames + leftover. */
export function decodeFrames(buf, maxBytes = GRPC_MAX_MESSAGE_BYTES) {
    const frames = [];
    let cursor = 0;
    for (;;) {
        const slice = buf.subarray(cursor);
        const decoded = decodeFrame(slice, maxBytes);
        if (!decoded)
            break;
        frames.push(decoded.payload);
        cursor += decoded.consumed;
    }
    return { frames, rest: buf.subarray(cursor) };
}
// gRPC status codes (subset)
export const GRPC_STATUS = {
    OK: 0,
    CANCELLED: 1,
    DEADLINE_EXCEEDED: 4,
    NOT_FOUND: 5,
    RESOURCE_EXHAUSTED: 8,
    INTERNAL: 13,
};
export class GrpcError extends Error {
    code;
    constructor(status, message) {
        super(message);
        this.name = 'GrpcError';
        this.code = GRPC_STATUS[status];
    }
}
/** Default JSON codec used to (de)serialize message payloads. */
export const jsonCodec = {
    encode(value) {
        return Buffer.from(JSON.stringify(value ?? null), 'utf8');
    },
    decode(buf) {
        return JSON.parse(buf.length === 0 ? 'null' : buf.toString('utf8'));
    },
};
/** Parse a gRPC `grpc-timeout` header (e.g. "100m", "1S") into milliseconds. */
export function parseGrpcTimeout(value) {
    if (!value)
        return null;
    const m = /^(\d+)([HMSmun])$/.exec(value.trim());
    if (!m)
        return null;
    const n = Number(m[1]);
    switch (m[2]) {
        case 'H': return n * 3_600_000;
        case 'M': return n * 60_000;
        case 'S': return n * 1_000;
        case 'm': return n;
        case 'u': return n / 1_000;
        case 'n': return n / 1_000_000;
        default: return null;
    }
}
//# sourceMappingURL=framing.js.map