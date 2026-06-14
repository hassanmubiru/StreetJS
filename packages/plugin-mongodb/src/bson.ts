// packages/plugin-mongodb/src/bson.ts
// A minimal, dependency-free BSON encoder/decoder covering the types needed for
// MongoDB commands and documents. Pure functions — fully offline-verifiable.
//
// Supported element types:
//   0x01 double · 0x02 string · 0x03 document · 0x04 array · 0x05 binary
//   0x07 ObjectId · 0x08 boolean · 0x09 UTC datetime · 0x0A null
//   0x10 int32 · 0x12 int64
//
// Spec: https://bsonspec.org/spec.html

export class BsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BsonError';
  }
}

/** A 12-byte MongoDB ObjectId. */
export class ObjectId {
  readonly bytes: Buffer;
  constructor(bytes?: Buffer) {
    if (bytes !== undefined) {
      if (bytes.length !== 12) throw new BsonError('ObjectId must be 12 bytes');
      this.bytes = Buffer.from(bytes);
    } else {
      this.bytes = Buffer.from(ObjectId.hex24(), 'hex');
    }
  }
  static fromHex(hex: string): ObjectId {
    if (!/^[0-9a-fA-F]{24}$/.test(hex)) throw new BsonError(`invalid ObjectId hex "${hex}"`);
    return new ObjectId(Buffer.from(hex, 'hex'));
  }
  toHexString(): string {
    return this.bytes.toString('hex');
  }
  private static counter = Math.floor(Math.random() * 0xffffff);
  private static hex24(): string {
    const ts = Math.floor(Date.now() / 1000) & 0xffffffff;
    const rand = Math.floor(Math.random() * 0xffffffffff);
    const c = (ObjectId.counter = (ObjectId.counter + 1) % 0x1000000);
    return (
      ts.toString(16).padStart(8, '0') +
      rand.toString(16).padStart(10, '0') +
      c.toString(16).padStart(6, '0')
    );
  }
}

/** BSON binary value (generic subtype 0x00 by default). */
export class BsonBinary {
  constructor(readonly data: Buffer, readonly subtype = 0x00) {}
}

export type BsonValue =
  | number | string | boolean | null
  | Date | ObjectId | BsonBinary | bigint
  | BsonDocument | BsonValue[];

export interface BsonDocument {
  [key: string]: BsonValue;
}

function cstring(key: string): Buffer {
  if (key.includes('\0')) throw new BsonError('BSON key must not contain a NUL byte');
  return Buffer.concat([Buffer.from(key, 'utf8'), Buffer.from([0])]);
}

function encodeString(value: string): Buffer {
  const utf8 = Buffer.from(value, 'utf8');
  const len = Buffer.alloc(4);
  len.writeInt32LE(utf8.length + 1, 0);
  return Buffer.concat([len, utf8, Buffer.from([0])]);
}

function encodeElement(key: string, value: BsonValue): Buffer {
  const name = cstring(key);
  const el = (type: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([type]), name, body]);

  if (value === null) return el(0x0a, Buffer.alloc(0));
  if (typeof value === 'boolean') return el(0x08, Buffer.from([value ? 1 : 0]));
  if (typeof value === 'bigint') {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(value, 0);
    return el(0x12, b);
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
      const b = Buffer.alloc(4);
      b.writeInt32LE(value, 0);
      return el(0x10, b);
    }
    const b = Buffer.alloc(8);
    b.writeDoubleLE(value, 0);
    return el(0x01, b);
  }
  if (typeof value === 'string') return el(0x02, encodeString(value));
  if (value instanceof Date) {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(BigInt(value.getTime()), 0);
    return el(0x09, b);
  }
  if (value instanceof ObjectId) return el(0x07, value.bytes);
  if (value instanceof BsonBinary) {
    const len = Buffer.alloc(4);
    len.writeInt32LE(value.data.length, 0);
    return el(0x05, Buffer.concat([len, Buffer.from([value.subtype]), value.data]));
  }
  if (Array.isArray(value)) {
    const doc: BsonDocument = {};
    value.forEach((v, i) => { doc[String(i)] = v; });
    return el(0x04, encodeDocument(doc));
  }
  if (typeof value === 'object') return el(0x03, encodeDocument(value as BsonDocument));
  throw new BsonError(`unsupported BSON value for key "${key}": ${typeof value}`);
}

/** Encode a plain object into a BSON document buffer. */
export function encodeDocument(doc: BsonDocument): Buffer {
  const parts: Buffer[] = [];
  for (const key of Object.keys(doc)) parts.push(encodeElement(key, doc[key]!));
  const body = Buffer.concat(parts);
  const out = Buffer.alloc(4 + body.length + 1);
  out.writeInt32LE(out.length, 0);
  body.copy(out, 4);
  out[out.length - 1] = 0x00;
  return out;
}

interface DecodeState { buf: Buffer; pos: number; }

function readCString(s: DecodeState): string {
  const end = s.buf.indexOf(0x00, s.pos);
  if (end === -1) throw new BsonError('unterminated cstring');
  const str = s.buf.toString('utf8', s.pos, end);
  s.pos = end + 1;
  return str;
}

function decodeValue(type: number, s: DecodeState): BsonValue {
  switch (type) {
    case 0x01: { const v = s.buf.readDoubleLE(s.pos); s.pos += 8; return v; }
    case 0x02: {
      const len = s.buf.readInt32LE(s.pos); s.pos += 4;
      const str = s.buf.toString('utf8', s.pos, s.pos + len - 1);
      s.pos += len;
      return str;
    }
    case 0x03: { const sub = decodeDocumentAt(s); return sub; }
    case 0x04: {
      const arrDoc = decodeDocumentAt(s);
      return Object.keys(arrDoc).map((k) => arrDoc[k]!);
    }
    case 0x05: {
      const len = s.buf.readInt32LE(s.pos); s.pos += 4;
      const subtype = s.buf[s.pos]!; s.pos += 1;
      const data = Buffer.from(s.buf.subarray(s.pos, s.pos + len)); s.pos += len;
      return new BsonBinary(data, subtype);
    }
    case 0x07: { const b = Buffer.from(s.buf.subarray(s.pos, s.pos + 12)); s.pos += 12; return new ObjectId(b); }
    case 0x08: { const v = s.buf[s.pos] === 1; s.pos += 1; return v; }
    case 0x09: { const ms = s.buf.readBigInt64LE(s.pos); s.pos += 8; return new Date(Number(ms)); }
    case 0x0a: return null;
    case 0x10: { const v = s.buf.readInt32LE(s.pos); s.pos += 4; return v; }
    case 0x12: { const v = s.buf.readBigInt64LE(s.pos); s.pos += 8; return v; }
    default:
      throw new BsonError(`unsupported BSON element type 0x${type.toString(16)}`);
  }
}

function decodeDocumentAt(s: DecodeState): BsonDocument {
  const start = s.pos;
  const len = s.buf.readInt32LE(s.pos); s.pos += 4;
  const end = start + len;
  const doc: BsonDocument = {};
  while (s.pos < end - 1) {
    const type = s.buf[s.pos]!; s.pos += 1;
    const key = readCString(s);
    doc[key] = decodeValue(type, s);
  }
  if (s.buf[end - 1] !== 0x00) throw new BsonError('document not NUL-terminated');
  s.pos = end;
  return doc;
}

/** Decode a BSON document buffer into a plain object. */
export function decodeDocument(buf: Buffer): BsonDocument {
  if (buf.length < 5) throw new BsonError('buffer too small to be a BSON document');
  const declared = buf.readInt32LE(0);
  if (declared !== buf.length) throw new BsonError(`BSON length mismatch: header ${declared}, buffer ${buf.length}`);
  return decodeDocumentAt({ buf, pos: 0 });
}
