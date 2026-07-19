// src/hash.ts
// Deterministic, dependency-free bucketing for percentage rollouts.
//
// Uses 32-bit FNV-1a over `${flagKey}:${subjectKey}` so the same subject always
// lands in the same bucket for a given flag (sticky rollouts) without any
// runtime dependency — safe on Node, edge runtimes, and browsers alike.

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a hash of a UTF-16 code-unit string. Returns an unsigned int. */
export function fnv1a32(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i) & 0xff;
    // Multiply by the FNV prime using Math.imul to stay in 32-bit space.
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0; // unsigned
}

/**
 * Map a `(flagKey, subjectKey)` pair to a stable bucket in `[0, 100)` with
 * two-decimal granularity (10 000 discrete buckets). The flag key is mixed in
 * so the same subject gets independent buckets across different flags.
 */
export function stableBucket(flagKey: string, subjectKey: string): number {
  const h = fnv1a32(`${flagKey}:${subjectKey}`);
  return (h % 10000) / 100; // 0.00 .. 99.99
}
