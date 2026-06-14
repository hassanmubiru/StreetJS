// packages/plugin-mongodb/src/opmsg.ts
// MongoDB wire-protocol OP_MSG (opcode 2013) framing. Pure functions —
// offline-verifiable. Encodes a command as a single kind-0 section; decodes a
// response's kind-0 body document.
//
// Message = header(16 bytes) + uint32 flagBits + [section: byte kind=0 + BSON].

import { encodeDocument, decodeDocument, type BsonDocument } from './bson.js';

export const OP_MSG = 2013;

export class WireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WireError';
  }
}

/** Encode an OP_MSG request carrying a single command document. */
export function encodeOpMsg(requestId: number, command: BsonDocument): Buffer {
  const bson = encodeDocument(command);
  const body = Buffer.alloc(4 + 1 + bson.length);
  body.writeUInt32LE(0, 0);          // flagBits
  body.writeUInt8(0, 4);             // section kind 0 (body)
  bson.copy(body, 5);

  const header = Buffer.alloc(16);
  const total = header.length + body.length;
  header.writeInt32LE(total, 0);     // messageLength
  header.writeInt32LE(requestId, 4); // requestID
  header.writeInt32LE(0, 8);         // responseTo
  header.writeInt32LE(OP_MSG, 12);   // opCode
  return Buffer.concat([header, body]);
}

export interface OpMsgReply {
  messageLength: number;
  requestId: number;
  responseTo: number;
  opCode: number;
  flagBits: number;
  document: BsonDocument;
}

/**
 * Parse a complete OP_MSG message. Returns `null` if `buf` does not yet contain
 * the full message (caller should read more bytes). Throws on protocol errors.
 */
export function parseOpMsg(buf: Buffer): OpMsgReply | null {
  if (buf.length < 16) return null;
  const messageLength = buf.readInt32LE(0);
  if (messageLength < 21) throw new WireError(`OP_MSG message too short: ${messageLength}`);
  if (buf.length < messageLength) return null;
  const requestId = buf.readInt32LE(4);
  const responseTo = buf.readInt32LE(8);
  const opCode = buf.readInt32LE(12);
  if (opCode !== OP_MSG) throw new WireError(`expected OP_MSG (2013), got opcode ${opCode}`);
  const flagBits = buf.readUInt32LE(16);
  const kind = buf.readUInt8(20);
  if (kind !== 0) throw new WireError(`unsupported OP_MSG section kind ${kind}`);
  const bson = buf.subarray(21, messageLength);
  return { messageLength, requestId, responseTo, opCode, flagBits, document: decodeDocument(bson) };
}
