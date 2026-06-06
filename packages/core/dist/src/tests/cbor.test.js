// src/tests/cbor.test.ts
// Focused unit tests for the minimal CBOR decoder used by WebAuthn.
// Run after `tsc`:
//   node --test dist/tests/cbor.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { decodeCbor } from '../auth/cbor.js';
describe('decodeCbor — unsigned integers (major type 0)', () => {
    it('decodes an immediate small uint (0-23)', () => {
        assert.equal(decodeCbor(Buffer.from([0x00])), 0);
        assert.equal(decodeCbor(Buffer.from([0x17])), 23);
    });
    it('decodes a 1-byte uint (additional info 24)', () => {
        assert.equal(decodeCbor(Buffer.from([0x18, 0xff])), 255);
    });
    it('decodes a 2-byte uint (additional info 25)', () => {
        assert.equal(decodeCbor(Buffer.from([0x19, 0x01, 0x00])), 256);
    });
    it('decodes a 4-byte uint (additional info 26)', () => {
        assert.equal(decodeCbor(Buffer.from([0x1a, 0x00, 0x01, 0x00, 0x00])), 65536);
    });
    it('decodes an 8-byte uint (additional info 27) as bigint', () => {
        const buf = Buffer.from([0x1b, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
        assert.equal(decodeCbor(buf), 4294967296n);
    });
});
describe('decodeCbor — negative integers (major type 1)', () => {
    it('decodes an immediate small negative int', () => {
        // 0x20 == -1, 0x26 == -7 (ES256 alg identifier)
        assert.equal(decodeCbor(Buffer.from([0x20])), -1);
        assert.equal(decodeCbor(Buffer.from([0x26])), -7);
    });
    it('decodes a 1-byte negative int', () => {
        // 0x38 0xff == -(255 + 1) == -256
        assert.equal(decodeCbor(Buffer.from([0x38, 0xff])), -256);
    });
});
describe('decodeCbor — byte strings (major type 2)', () => {
    it('decodes a byte string into a Buffer', () => {
        const result = decodeCbor(Buffer.from([0x43, 0x01, 0x02, 0x03]));
        assert.ok(Buffer.isBuffer(result));
        assert.deepEqual(result, Buffer.from([0x01, 0x02, 0x03]));
    });
    it('decodes an empty byte string', () => {
        const result = decodeCbor(Buffer.from([0x40]));
        assert.ok(Buffer.isBuffer(result));
        assert.equal(result.length, 0);
    });
});
describe('decodeCbor — text strings (major type 3)', () => {
    it('decodes a UTF-8 text string', () => {
        // 0x65 == text string of length 5
        const buf = Buffer.concat([Buffer.from([0x65]), Buffer.from('hello', 'utf8')]);
        assert.equal(decodeCbor(buf), 'hello');
    });
});
describe('decodeCbor — arrays (major type 4)', () => {
    it('decodes an array of integers', () => {
        // 0x83 == array of length 3, then 1, 2, 3
        assert.deepEqual(decodeCbor(Buffer.from([0x83, 0x01, 0x02, 0x03])), [1, 2, 3]);
    });
    it('decodes an empty array', () => {
        assert.deepEqual(decodeCbor(Buffer.from([0x80])), []);
    });
});
describe('decodeCbor — maps (major type 5)', () => {
    it('decodes a map with integer keys (stringified)', () => {
        // 0xa1 == map of 1 pair: key 1 -> value 2
        assert.deepEqual(decodeCbor(Buffer.from([0xa1, 0x01, 0x02])), { '1': 2 });
    });
    it('decodes a map mixing positive and negative integer keys', () => {
        // 0xa2 == map of 2 pairs: key 1 -> 2, key -1 -> 3
        const result = decodeCbor(Buffer.from([0xa2, 0x01, 0x02, 0x20, 0x03]));
        assert.deepEqual(result, { '1': 2, '-1': 3 });
    });
});
describe('decodeCbor — error handling', () => {
    it('throws on an empty buffer', () => {
        assert.throws(() => decodeCbor(Buffer.alloc(0)), /unexpected end of buffer/);
    });
});
//# sourceMappingURL=cbor.test.js.map