// src/transports/rabbitmq/codec.ts
// AMQP 0-9-1 wire codec: frame (de)serialization and the field encodings used
// by the method/header frames this client implements. Pure node:buffer.
export const FRAME_METHOD = 1;
export const FRAME_HEADER = 2;
export const FRAME_BODY = 3;
export const FRAME_HEARTBEAT = 8;
export const FRAME_END = 0xce;
/** The AMQP protocol header sent first on a new connection. */
export const PROTOCOL_HEADER = Buffer.from([0x41, 0x4d, 0x51, 0x50, 0, 0, 9, 1]);
// ── Writer ────────────────────────────────────────────────────────────────────
export class AmqpWriter {
    chunks = [];
    octet(v) { this.chunks.push(Buffer.from([v & 0xff])); return this; }
    shortUint(v) { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff, 0); this.chunks.push(b); return this; }
    longUint(v) { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); this.chunks.push(b); return this; }
    longLong(v) { const b = Buffer.alloc(8); b.writeBigUInt64BE(v, 0); this.chunks.push(b); return this; }
    shortStr(s) {
        const buf = Buffer.from(s, 'utf8');
        if (buf.length > 255)
            throw new Error('AMQP short string exceeds 255 bytes');
        this.octet(buf.length);
        this.chunks.push(buf);
        return this;
    }
    longStr(s) {
        const buf = Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8');
        this.longUint(buf.length);
        this.chunks.push(buf);
        return this;
    }
    /** Encode an AMQP field table from a plain object (string/number/bool values). */
    table(obj) {
        const inner = new AmqpWriter();
        for (const [key, value] of Object.entries(obj)) {
            inner.shortStr(key);
            inner._field(value);
        }
        const body = inner.build();
        this.longUint(body.length);
        this.chunks.push(body);
        return this;
    }
    _field(value) {
        if (typeof value === 'string') {
            this.octet(0x53); // 'S' long string
            this.longStr(value);
        }
        else if (typeof value === 'boolean') {
            this.octet(0x74); // 't' bool
            this.octet(value ? 1 : 0);
        }
        else if (typeof value === 'number' && Number.isInteger(value)) {
            this.octet(0x49); // 'I' long-int (signed 32)
            const b = Buffer.alloc(4);
            b.writeInt32BE(value, 0);
            this.chunks.push(b);
        }
        else if (typeof value === 'object' && value !== null) {
            this.octet(0x46); // 'F' field table
            this.table(value);
        }
        else {
            this.octet(0x56); // 'V' void
        }
    }
    /** Pack a list of booleans into AMQP bit octets (LSB first). */
    bits(...flags) {
        let byte = 0;
        let n = 0;
        for (let i = 0; i < flags.length; i++) {
            if (flags[i])
                byte |= (1 << (i % 8));
            n++;
            if (n % 8 === 0) {
                this.octet(byte);
                byte = 0;
            }
        }
        if (n % 8 !== 0)
            this.octet(byte);
        return this;
    }
    build() { return Buffer.concat(this.chunks); }
}
// ── Reader ────────────────────────────────────────────────────────────────────
export class AmqpReader {
    buf;
    offset = 0;
    constructor(buf) {
        this.buf = buf;
    }
    octet() { const v = this.buf.readUInt8(this.offset); this.offset += 1; return v; }
    shortUint() { const v = this.buf.readUInt16BE(this.offset); this.offset += 2; return v; }
    longUint() { const v = this.buf.readUInt32BE(this.offset); this.offset += 4; return v; }
    longLong() { const v = this.buf.readBigUInt64BE(this.offset); this.offset += 8; return v; }
    shortStr() {
        const len = this.octet();
        const s = this.buf.toString('utf8', this.offset, this.offset + len);
        this.offset += len;
        return s;
    }
    longStr() {
        const len = this.longUint();
        const s = this.buf.subarray(this.offset, this.offset + len);
        this.offset += len;
        return s;
    }
    /** Skip a field table (we rarely need to read server tables). */
    skipTable() {
        const len = this.longUint();
        this.offset += len;
    }
    bit() { return (this.octet() & 1) === 1; }
    get remaining() { return this.buf.subarray(this.offset); }
}
// ── Frame framing ─────────────────────────────────────────────────────────────
/** Wrap a payload in an AMQP frame: [type][channel][size][payload][0xCE]. */
export function buildFrame(type, channel, payload) {
    const head = Buffer.alloc(7);
    head.writeUInt8(type, 0);
    head.writeUInt16BE(channel, 1);
    head.writeUInt32BE(payload.length, 3);
    return Buffer.concat([head, payload, Buffer.from([FRAME_END])]);
}
/** Build a METHOD frame: payload = [class-id][method-id][args]. */
export function buildMethodFrame(channel, classId, methodId, args) {
    const head = new AmqpWriter().shortUint(classId).shortUint(methodId).build();
    return buildFrame(FRAME_METHOD, channel, Buffer.concat([head, args]));
}
/** Build a content HEADER frame for Basic.Publish. */
export function buildHeaderFrame(channel, classId, bodySize, properties = {}) {
    const w = new AmqpWriter();
    w.shortUint(classId); // class-id
    w.shortUint(0); // weight (always 0)
    w.longLong(BigInt(bodySize));
    // Property flags + properties. We support content-type, delivery-mode, content-encoding.
    let flags = 0;
    const propWriter = new AmqpWriter();
    const contentType = properties['contentType'];
    const deliveryMode = properties['deliveryMode'];
    if (typeof contentType === 'string') {
        flags |= 0x8000;
        propWriter.shortStr(contentType);
    }
    if (typeof deliveryMode === 'number') {
        flags |= 0x1000;
        propWriter.octet(deliveryMode);
    }
    w.shortUint(flags);
    return buildFrame(FRAME_HEADER, channel, Buffer.concat([w.build(), propWriter.build()]));
}
/** Build a BODY frame. */
export function buildBodyFrame(channel, body) {
    return buildFrame(FRAME_BODY, channel, body);
}
/** Build a HEARTBEAT frame (channel 0, empty payload). */
export function buildHeartbeat() {
    return buildFrame(FRAME_HEARTBEAT, 0, Buffer.alloc(0));
}
// ── Incremental frame decoder ─────────────────────────────────────────────────
/** Accumulates socket bytes and yields complete frames. */
export class FrameDecoder {
    buf = Buffer.alloc(0);
    push(chunk) {
        this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    }
    next() {
        if (this.buf.length < 7)
            return null;
        const type = this.buf.readUInt8(0);
        const channel = this.buf.readUInt16BE(1);
        const size = this.buf.readUInt32BE(3);
        if (this.buf.length < 7 + size + 1)
            return null;
        const payload = this.buf.subarray(7, 7 + size);
        const end = this.buf.readUInt8(7 + size);
        if (end !== FRAME_END)
            throw new Error(`AMQP frame end byte mismatch: 0x${end.toString(16)}`);
        this.buf = this.buf.subarray(7 + size + 1);
        return { type, channel, payload };
    }
}
/** Parse the class-id/method-id prefix of a METHOD frame payload. */
export function readMethodHeader(payload) {
    const reader = new AmqpReader(payload);
    const classId = reader.shortUint();
    const methodId = reader.shortUint();
    return { classId, methodId, reader };
}
//# sourceMappingURL=codec.js.map