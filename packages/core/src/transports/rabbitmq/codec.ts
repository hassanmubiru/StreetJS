// src/transports/rabbitmq/codec.ts
// AMQP 0-9-1 wire codec: frame (de)serialization and the field encodings used
// by the method/header frames this client implements. Pure node:buffer.

export const FRAME_METHOD = 1;
export const FRAME_HEADER = 2;
export const FRAME_BODY = 3;
export const FRAME_HEARTBEAT = 8;
export const FRAME_END = 0xce;

export interface RawFrame {
  type: number;
  channel: number;
  payload: Buffer;
}

/** The AMQP protocol header sent first on a new connection. */
export const PROTOCOL_HEADER = Buffer.from([0x41, 0x4d, 0x51, 0x50, 0, 0, 9, 1]);

// ── Writer ────────────────────────────────────────────────────────────────────

export class AmqpWriter {
  private chunks: Buffer[] = [];

  octet(v: number): this { this.chunks.push(Buffer.from([v & 0xff])); return this; }
  shortUint(v: number): this { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff, 0); this.chunks.push(b); return this; }
  longUint(v: number): this { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); this.chunks.push(b); return this; }
  longLong(v: bigint): this { const b = Buffer.alloc(8); b.writeBigUInt64BE(v, 0); this.chunks.push(b); return this; }

  shortStr(s: string): this {
    const buf = Buffer.from(s, 'utf8');
    if (buf.length > 255) throw new Error('AMQP short string exceeds 255 bytes');
    this.octet(buf.length);
    this.chunks.push(buf);
    return this;
  }

  longStr(s: string | Buffer): this {
    const buf = Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8');
    this.longUint(buf.length);
    this.chunks.push(buf);
    return this;
  }

  /** Encode an AMQP field table from a plain object (string/number/bool values). */
  table(obj: Record<string, unknown>): this {
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

  private _field(value: unknown): void {
    if (typeof value === 'string') {
      this.octet(0x53); // 'S' long string
      this.longStr(value);
    } else if (typeof value === 'boolean') {
      this.octet(0x74); // 't' bool
      this.octet(value ? 1 : 0);
    } else if (typeof value === 'number' && Number.isInteger(value)) {
      this.octet(0x49); // 'I' long-int (signed 32)
      const b = Buffer.alloc(4); b.writeInt32BE(value, 0); this.chunks.push(b);
    } else if (typeof value === 'object' && value !== null) {
      this.octet(0x46); // 'F' field table
      this.table(value as Record<string, unknown>);
    } else {
      this.octet(0x56); // 'V' void
    }
  }

  /** Pack a list of booleans into AMQP bit octets (LSB first). */
  bits(...flags: boolean[]): this {
    let byte = 0; let n = 0;
    for (let i = 0; i < flags.length; i++) {
      if (flags[i]) byte |= (1 << (i % 8));
      n++;
      if (n % 8 === 0) { this.octet(byte); byte = 0; }
    }
    if (n % 8 !== 0) this.octet(byte);
    return this;
  }

  build(): Buffer { return Buffer.concat(this.chunks); }
}

// ── Reader ────────────────────────────────────────────────────────────────────

export class AmqpReader {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}

  octet(): number { const v = this.buf.readUInt8(this.offset); this.offset += 1; return v; }
  shortUint(): number { const v = this.buf.readUInt16BE(this.offset); this.offset += 2; return v; }
  longUint(): number { const v = this.buf.readUInt32BE(this.offset); this.offset += 4; return v; }
  longLong(): bigint { const v = this.buf.readBigUInt64BE(this.offset); this.offset += 8; return v; }

  shortStr(): string {
    const len = this.octet();
    const s = this.buf.toString('utf8', this.offset, this.offset + len);
    this.offset += len;
    return s;
  }

  longStr(): Buffer {
    const len = this.longUint();
    const s = this.buf.subarray(this.offset, this.offset + len);
    this.offset += len;
    return s;
  }

  /** Skip a field table (we rarely need to read server tables). */
  skipTable(): void {
    const len = this.longUint();
    this.offset += len;
  }

  bit(): boolean { return (this.octet() & 1) === 1; }

  get remaining(): Buffer { return this.buf.subarray(this.offset); }
}
