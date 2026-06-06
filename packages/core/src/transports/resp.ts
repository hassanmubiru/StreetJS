// src/transports/resp.ts
// Minimal RESP (REdis Serialization Protocol) codec + client over node:net.
// Zero dependencies. Supports the command subset used by the event bus and
// distributed cache transports: GET, SET (EX), DEL, SUBSCRIBE, PUBLISH.

import { createConnection, type Socket } from 'node:net';

/** Encode a command as a RESP2 array of bulk strings. */
export function encodeCommand(args: (string | number)[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`, 'utf8')];
  for (const arg of args) {
    const s = String(arg);
    parts.push(Buffer.from(`$${Buffer.byteLength(s)}\r\n${s}\r\n`, 'utf8'));
  }
  return Buffer.concat(parts);
}

export type RespValue = string | number | null | RespValue[];

/**
 * Incremental RESP2 reply parser. Feed bytes via `push()`; call `parse()` to
 * pull complete replies. Returns `undefined` when more data is needed.
 */
export class RespParser {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer): void {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
  }

  parse(): RespValue | undefined {
    const result = this._parseAt(0);
    if (result === undefined) return undefined;
    this.buf = this.buf.subarray(result.next);
    return result.value;
  }

  private _lineEnd(start: number): number {
    const idx = this.buf.indexOf('\r\n', start, 'utf8');
    return idx;
  }

  private _parseAt(pos: number): { value: RespValue; next: number } | undefined {
    if (pos >= this.buf.length) return undefined;
    const type = String.fromCharCode(this.buf[pos]!);
    const lineEnd = this._lineEnd(pos + 1);
    if (lineEnd === -1) return undefined;
    const line = this.buf.toString('utf8', pos + 1, lineEnd);
    const after = lineEnd + 2;

    switch (type) {
      case '+': return { value: line, next: after };
      case '-': return { value: `ERR:${line}`, next: after };
      case ':': return { value: Number(line), next: after };
      case '$': {
        const len = Number(line);
        if (len === -1) return { value: null, next: after };
        if (after + len + 2 > this.buf.length) return undefined;
        return { value: this.buf.toString('utf8', after, after + len), next: after + len + 2 };
      }
      case '*': {
        const count = Number(line);
        if (count === -1) return { value: null, next: after };
        const arr: RespValue[] = [];
        let cursor = after;
        for (let i = 0; i < count; i++) {
          const el = this._parseAt(cursor);
          if (el === undefined) return undefined;
          arr.push(el.value);
          cursor = el.next;
        }
        return { value: arr, next: cursor };
      }
      default:
        return { value: line, next: after };
    }
  }
}
