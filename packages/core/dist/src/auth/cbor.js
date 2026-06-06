// src/auth/cbor.ts
// Minimal CBOR decoder for the subset used in WebAuthn attestation/assertion
// objects. Uses node:buffer (Buffer) only — zero external dependencies.
//
// Supported major types:
//   0 — unsigned integer
//   1 — negative integer
//   2 — byte string
//   3 — text string
//   4 — array
//   5 — map
//
// Additional info encodings handled: immediate (0-23), 1-byte (24),
// 2-byte (25), 4-byte (26) and 8-byte (27) length/value fields.
/** Decode a subset of CBOR used in WebAuthn attestation/assertion objects. */
export function decodeCbor(buf) {
    const [value] = _decodeCborItem(buf, 0);
    return value;
}
export function _decodeCborItem(buf, offset) {
    if (offset >= buf.length)
        throw new Error('CBOR: unexpected end of buffer');
    const initial = buf[offset];
    const majorType = (initial >> 5) & 0x07;
    const additionalInfo = initial & 0x1f;
    offset += 1;
    let value;
    if (additionalInfo <= 23) {
        value = additionalInfo;
    }
    else if (additionalInfo === 24) {
        value = buf[offset];
        offset += 1;
    }
    else if (additionalInfo === 25) {
        value = buf.readUInt16BE(offset);
        offset += 2;
    }
    else if (additionalInfo === 26) {
        value = buf.readUInt32BE(offset);
        offset += 4;
    }
    else if (additionalInfo === 27) {
        value = buf.readBigUInt64BE(offset);
        offset += 8;
    }
    else {
        value = 0;
    }
    switch (majorType) {
        case 0: return [value, offset]; // unsigned int
        case 1: return [-(Number(value) + 1), offset]; // negative int
        case 2: { // byte string
            const len = Number(value);
            const bytes = buf.subarray(offset, offset + len);
            return [bytes, offset + len];
        }
        case 3: { // text string
            const len = Number(value);
            const text = buf.toString('utf8', offset, offset + len);
            return [text, offset + len];
        }
        case 4: { // array
            const count = Number(value);
            const arr = [];
            for (let i = 0; i < count; i++) {
                const [item, next] = _decodeCborItem(buf, offset);
                arr.push(item);
                offset = next;
            }
            return [arr, offset];
        }
        case 5: { // map
            const count = Number(value);
            const map = {};
            for (let i = 0; i < count; i++) {
                const [k, next1] = _decodeCborItem(buf, offset);
                offset = next1;
                const [v, next2] = _decodeCborItem(buf, offset);
                offset = next2;
                map[String(k)] = v;
            }
            return [map, offset];
        }
        default:
            return [null, offset];
    }
}
//# sourceMappingURL=cbor.js.map