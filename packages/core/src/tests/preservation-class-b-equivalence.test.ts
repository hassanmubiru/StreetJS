// tests/preservation-class-b-equivalence.test.ts
// Class B preservation baseline (Property 7 — Non-Buggy Inputs Unchanged).
//
// Captures the CURRENT (pre-fix) behavior of the two core-package sites flagged
// for ReDoS, for WELL-FORMED input (the preservation domain):
//   B.1  base32Decode (auth/mfa.ts)            — valid base32 round-trips identically
//   B.3  parseProto   (grpc/proto-parser.ts)   — existing fixtures yield an identical AST
//
// The Class B fix replaces each polynomial regex with a linear-time equivalent
// that must produce byte-identical output for well-formed input: F(X) === F'(X).
//
// No fast-check available — Property-style coverage uses a deterministic seeded
// PRNG so the sampled inputs are reproducible run-to-run.
//
// (B.2 — the CLI generateGrpc basename derivation — lives in the cli package's
// preservation-class-b-grpc-basename.test.ts because core cannot import the CLI.)
//
// **Validates: Requirements 3.2, 3.7**

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { base32Encode, base32Decode } from '../auth/mfa.js';
import { parseProto, type ProtoAst } from '../microservices/grpc/proto-parser.js';

// ── Deterministic seeded PRNG (mulberry32) ───────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── B.1 — base32 round-trip for valid input ──────────────────────────────────

describe('Class B.1 preservation — base32Decode round-trips valid input', () => {
  it('decodes base32Encode(buf) back to the original buffer (RFC 4648)', () => {
    const rng = mulberry32(0xb32d_ec0d);
    for (let trial = 0; trial < 500; trial++) {
      const len = Math.floor(rng() * 40); // 0..39 bytes
      const buf = Buffer.alloc(len);
      for (let i = 0; i < len; i++) buf[i] = Math.floor(rng() * 256);

      const encoded = base32Encode(buf);
      // base32Encode emits only [A-Z2-7]; decoding must reconstruct the bytes.
      const decoded = base32Decode(encoded);
      assert.deepEqual(decoded, buf, `round-trip mismatch for ${encoded}`);

      // Re-encoding the decode is stable (canonical form preserved).
      assert.equal(base32Encode(decoded), encoded);
    }
  });

  it('still tolerates trailing padding and whitespace exactly as before', () => {
    // Known vectors: padded/whitespaced forms decode to the same bytes.
    const buf = base32Decode('JBSWY3DPEHPK3PXP'); // "Hello!\xde\xad\xbe\xef"-ish vector
    assert.deepEqual(base32Decode('JBSWY3DPEHPK3PXP======'), buf, 'trailing = ignored');
    assert.deepEqual(base32Decode('JBSWY3DP EHPK3PXP'), buf, 'whitespace ignored');
    assert.deepEqual(base32Decode('jbswy3dpehpk3pxp'), buf, 'lowercase upcased');
  });

  it('still throws on an invalid base32 character (behavior preserved)', () => {
    assert.throws(() => base32Decode('ABC1'), /Invalid base32 character/);
  });
});

// ── B.3 — parseProto AST equivalence for existing fixtures ────────────────────

// The same fixture exercised by the existing gRPC proto-parser test suite.
const PROTO_FIXTURE = `
  package demo;
  // a line comment
  message AddRequest { int32 a = 1; int32 b = 2; }
  /* a block comment
     spanning lines */
  message AddReply { int32 sum = 1; }
  service Calc {
    rpc Add (AddRequest) returns (AddReply);
    rpc Feed (stream AddRequest) returns (AddReply);
    rpc Watch (AddRequest) returns (stream AddReply);
  }
`;

// Observed (pre-fix) AST for PROTO_FIXTURE — the baseline to preserve.
const EXPECTED_AST: ProtoAst = {
  packageName: 'demo',
  messages: [
    {
      name: 'AddRequest',
      fields: [
        { repeated: false, type: 'int32', name: 'a', number: 1 },
        { repeated: false, type: 'int32', name: 'b', number: 2 },
      ],
    },
    {
      name: 'AddReply',
      fields: [{ repeated: false, type: 'int32', name: 'sum', number: 1 }],
    },
  ],
  services: [
    {
      name: 'Calc',
      rpcs: [
        { name: 'Add', clientStreaming: false, requestType: 'AddRequest', serverStreaming: false, responseType: 'AddReply' },
        { name: 'Feed', clientStreaming: true, requestType: 'AddRequest', serverStreaming: false, responseType: 'AddReply' },
        { name: 'Watch', clientStreaming: false, requestType: 'AddRequest', serverStreaming: true, responseType: 'AddReply' },
      ],
    },
  ],
};

describe('Class B.3 preservation — parseProto AST unchanged for fixtures', () => {
  it('produces the exact observed AST (comments stripped, streaming flags intact)', () => {
    const ast = parseProto(PROTO_FIXTURE);
    assert.deepEqual(ast, EXPECTED_AST);
  });

  it('is stable across repeated parses (idempotent for the same source)', () => {
    assert.deepEqual(parseProto(PROTO_FIXTURE), parseProto(PROTO_FIXTURE));
  });
});
