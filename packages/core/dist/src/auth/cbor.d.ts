import { Buffer } from 'node:buffer';
/** Decode a subset of CBOR used in WebAuthn attestation/assertion objects. */
export declare function decodeCbor(buf: Buffer): unknown;
export declare function _decodeCborItem(buf: Buffer, offset: number): [unknown, number];
//# sourceMappingURL=cbor.d.ts.map