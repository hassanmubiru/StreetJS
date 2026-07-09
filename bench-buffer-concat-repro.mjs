// Repro benchmark for the exact pattern in packages/core/src/database/wire.ts
// _onData() and packages/core/src/database/mysql/wire.ts _onData():
//   this.buffer = Buffer.concat([this.buffer, chunk]);
// called once per incoming socket 'data' event, accumulating a growing buffer
// until a complete message is framed and sliced off.
//
// This measures actual wall-clock cost of receiving a single large result set
// as many small chunks (the realistic TCP scenario: a socket delivers data in
// ~16-64KB OS-buffer-sized chunks, not one big chunk), comparing:
//   (a) the current pattern: Buffer.concat([this.buffer, chunk]) every chunk
//   (b) an alternative: collect chunks in an array, concat once at the end
//
// If accumulation is genuinely O(n^2) in the number of chunks, (a) should be
// dramatically slower than (b) as chunk count grows, since each concat copies
// the ENTIRE accumulated buffer again.

import { performance } from 'node:perf_hooks';

function timeIt(fn) {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function runCurrentPattern(totalBytes, chunkSize) {
  const chunk = Buffer.alloc(chunkSize, 1);
  const numChunks = Math.ceil(totalBytes / chunkSize);
  let buffer = Buffer.alloc(0);
  for (let i = 0; i < numChunks; i++) {
    buffer = Buffer.concat([buffer, chunk]); // current wire.ts/_onData pattern
  }
  return buffer.length;
}

function runArrayCollectPattern(totalBytes, chunkSize) {
  const chunk = Buffer.alloc(chunkSize, 1);
  const numChunks = Math.ceil(totalBytes / chunkSize);
  const chunks = [];
  for (let i = 0; i < numChunks; i++) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks); // single concat at drain time
  return buffer.length;
}

console.log('Buffer accumulation strategy comparison (realistic TCP chunk sizes)\n');
console.log('total_bytes  chunk_size  num_chunks  current_ms  array_collect_ms  ratio');

// Realistic scenario: TCP delivers data in OS-buffer-sized chunks (commonly
// 16KB-64KB per read). Vary the TOTAL result-set size to see how the current
// per-chunk-concat pattern scales as chunk COUNT grows.
const scenarios = [
  { totalBytes: 1_000_000, chunkSize: 16_384 },     // 1MB in 16KB chunks (~61 chunks)
  { totalBytes: 10_000_000, chunkSize: 16_384 },    // 10MB in 16KB chunks (~611 chunks)
  { totalBytes: 50_000_000, chunkSize: 16_384 },    // 50MB in 16KB chunks (~3052 chunks)
  { totalBytes: 100_000_000, chunkSize: 16_384 },   // 100MB in 16KB chunks (~6104 chunks)
];

for (const { totalBytes, chunkSize } of scenarios) {
  const numChunks = Math.ceil(totalBytes / chunkSize);
  const currentMs = timeIt(() => runCurrentPattern(totalBytes, chunkSize));
  const arrayMs = timeIt(() => runArrayCollectPattern(totalBytes, chunkSize));
  const ratio = (currentMs / arrayMs).toFixed(1);
  console.log(
    `${totalBytes.toLocaleString().padStart(11)}  ${chunkSize.toString().padStart(10)}  ${numChunks.toString().padStart(10)}  ${currentMs.toFixed(1).padStart(10)}  ${arrayMs.toFixed(1).padStart(16)}  ${ratio}x`,
  );
}

console.log('\nIf "current" scales worse than linearly relative to "array_collect" as num_chunks');
console.log('grows (ratio increasing with chunk count), that is direct evidence of O(n^2)');
console.log('behavior in the per-chunk Buffer.concat([this.buffer, chunk]) pattern.');
