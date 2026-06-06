// src/microservices/grpc/framing.ts
// gRPC length-prefixed message framing: [1-byte compressed flag][4-byte BE length][payload].
// The payload codec is pluggable; the default is JSON (self-consistent codec).

export const GRPC_MAX_MESSAGE_BYTES = 4 * 1024 * 1024; // 4 MB default

/** Encode a single payload buffer into a gRPC length-prefixed frame. */
export function encodeFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt8(0, 0); // not compressed
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export interface DecodedFrame {
  payload: Buffer;
  /** Number of bytes consumed from the input. */
  consumed: number;
}

/**
 * Decode the first complete gRPC frame from `buf`, or null if incomplete.
 * Throws if the declared length exceeds `maxBytes` (RESOURCE_EXHAUSTED).
 */
export function decodeFrame(buf: Buffer, maxBytes = GRPC_MAX_MESSAGE_BYTES): DecodedFrame | null {
  if (buf.length < 5) return null;
  const length = buf.readUInt32BE(1);
  if (length > maxBytes) {
    throw new GrpcError('RESOURCE_EXHAUSTED', `message length ${length} exceeds limit ${maxBytes}`);
  }
  if (buf.length < 5 + length) return null;
  return { payload: buf.subarray(5, 5 + length), consumed: 5 + length };
}

/** Decode all complete frames available in `buf`; returns frames + leftover. */
export function decodeFrames(buf: Buffer, maxBytes = GRPC_MAX_MESSAGE_BYTES): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let cursor = 0;
  for (;;) {
    const slice = buf.subarray(cursor);
    const decoded = decodeFrame(slice, maxBytes);
    if (!decoded) break;
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
} as const;

export type GrpcStatusName = keyof typeof GRPC_STATUS;

export class GrpcError extends Error {
  readonly code: number;
  constructor(status: GrpcStatusName, message: string) {
    super(message);
    this.name = 'GrpcError';
    this.code = GRPC_STATUS[status];
  }
}

/** Default JSON codec used to (de)serialize message payloads. */
export const jsonCodec = {
  encode(value: unknown): Buffer {
    return Buffer.from(JSON.stringify(value ?? null), 'utf8');
  },
  decode<T = unknown>(buf: Buffer): T {
    return JSON.parse(buf.length === 0 ? 'null' : buf.toString('utf8')) as T;
  },
};

/** Parse a gRPC `grpc-timeout` header (e.g. "100m", "1S") into milliseconds. */
export function parseGrpcTimeout(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^(\d+)([HMSmun])$/.exec(value.trim());
  if (!m) return null;
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
