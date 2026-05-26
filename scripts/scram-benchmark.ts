// scripts/scram-benchmark.ts
// Benchmark SCRAM-SHA-256 authentication performance at various iteration counts.
//
// Usage: npx tsx scripts/scram-benchmark.ts

import { pbkdf2Sync, createHmac, createHash, randomBytes } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

const ITERATION_COUNTS = [
  4_096,      // PostgreSQL default
  10_000,     // Common minimum
  100_000,    // OWASP recommended minimum
  310_000,    // OWASP 2023 recommended for PBKDF2-HMAC-SHA256
  1_000_000,  // 1M — mid-high
  10_000_000, // 10M — current max in validation
];

const SAMPLES = 30;
const WARMUP = 5;

const PASSWORD = 'benchmark-password-abc123';
const SALT = randomBytes(16);
const NONCE = randomBytes(18).toString('base64url');

// ─── SCRAM Auth Simulator ─────────────────────────────────────────────────────

function scramAuth(password: string, salt: Buffer, iterations: number, nonce: string): Buffer {
  const normalizedPassword = password.normalize('NFKC');
  const saltedPassword = pbkdf2Sync(normalizedPassword, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', saltedPassword).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverFirstMessage = `r=${nonce},s=${salt.toString('base64')},i=${iterations}`;
  const clientFinalMessageWithoutProof = `c=biws,r=${nonce}`;
  const authMessage = `n=${PASSWORD},r=${nonce},${serverFirstMessage},${clientFinalMessageWithoutProof}`;
  const clientSignature = createHmac('sha256', storedKey).update(authMessage).digest();
  // XOR clientKey ^ clientSignature
  const out = Buffer.allocUnsafe(clientKey.length);
  for (let i = 0; i < clientKey.length; i++) {
    out[i] = clientKey[i]! ^ clientSignature[i]!;
  }
  return out;
}

// ─── Benchmark Runner ─────────────────────────────────────────────────────────

function bench(fn: () => void, samples: number): { min: number; avg: number; max: number } {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = process.hrtime.bigint();
    fn();
    const end = process.hrtime.bigint();
    times.push(Number(end - start) / 1_000_000); // ms
  }
  const total = times.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...times),
    avg: total / times.length,
    max: Math.max(...times),
  };
}

// ─── Header ───────────────────────────────────────────────────────────────────

console.log('='.repeat(90));
console.log('  SCRAM-SHA-256 Authentication Performance Benchmark');
console.log(`  Samples: ${SAMPLES} per count  |  Warmup: ${WARMUP}  |  Password: ${PASSWORD.length} chars  |  Salt: ${SALT.length} bytes`);
console.log('='.repeat(90));

// Warmup at lowest iteration count
console.log('\n  Warming up V8 JIT...');
for (let i = 0; i < WARMUP; i++) {
  pbkdf2Sync(PASSWORD, SALT, 4096, 32, 'sha256');
  scramAuth(PASSWORD, SALT, 4096, NONCE);
}
console.log('  Done.\n');

// ─── Pass 1: PBKDF2-only ──────────────────────────────────────────────────────

console.log('  ── PBKDF2-SHA256 Only ──');
console.log(`  ${'Iterations'.padStart(10)}  |  ${'Avg (ms)'.padStart(10)}  |  ${'Min→Max'.padStart(14)}  |  ${'Ops/sec'.padStart(10)}`);
console.log('  ' + '-'.repeat(55));

for (const iterations of ITERATION_COUNTS) {
  const r = bench(() => {
    pbkdf2Sync(PASSWORD, SALT, iterations, 32, 'sha256');
  }, SAMPLES);
  const opsPerSec = (1000 / r.avg).toFixed(0);
  console.log(
    `  ${String(iterations).padStart(10)}  |` +
    `  ${r.avg.toFixed(3).padStart(10)}  |` +
    `  ${r.min.toFixed(2)}→${r.max.toFixed(2)} ms  |` +
    `  ${opsPerSec.padStart(8)}`
  );
}

// ─── Pass 2: Full SCRAM Auth ──────────────────────────────────────────────────

console.log('\n  ── Full SCRAM Auth (PBKDF2 + HMAC+SHA256×3 + XOR) ──');
console.log(`  ${'Iterations'.padStart(10)}  |  ${'Avg (ms)'.padStart(10)}  |  ${'Min→Max'.padStart(14)}  |  ${'Factor vs 4K'.padStart(13)}  |  ${'Factor vs prev'.padStart(14)}`);
console.log('  ' + '-'.repeat(70));

// Get baseline at 4096 for accurate factor computation
const baselineResult = bench(() => {
  scramAuth(PASSWORD, SALT, 4096, NONCE);
}, SAMPLES);
const baselineAvg = baselineResult.avg;

let prevAvg = 0;

for (const iterations of ITERATION_COUNTS) {
  const r = bench(() => {
    scramAuth(PASSWORD, SALT, iterations, NONCE);
  }, SAMPLES);

  const factorVsBaseline = (r.avg / baselineAvg).toFixed(2);
  const factorVsPrev = prevAvg > 0 ? (r.avg / prevAvg).toFixed(2) : '-';

  console.log(
    `  ${String(iterations).padStart(10)}  |` +
    `  ${r.avg.toFixed(3).padStart(10)}  |` +
    `  ${r.min.toFixed(2)}→${r.max.toFixed(2)} ms  |` +
    `  ${('×' + factorVsBaseline).padStart(12)}  |` +
    `  ${factorVsPrev !== '-' ? '×' + factorVsPrev : '-'.padStart(14)}`
  );

  prevAvg = r.avg;
}

// ─── Compute overhead ─────────────────────────────────────────────────────────

const pbkdf2At4096 = bench(() => {
  pbkdf2Sync(PASSWORD, SALT, 4096, 32, 'sha256');
}, SAMPLES);

const overhead = baselineAvg - pbkdf2At4096.avg;

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(90));
console.log('  SUMMARY');
console.log('='.repeat(90));
console.log(`\n  Auth overhead (HMAC+SHA256+XOR, outside PBKDF2):  ${overhead.toFixed(3)} ms`);
console.log(`  Baseline (4096, PostgreSQL default):            ${baselineAvg.toFixed(3)} ms`);
console.log(`  Current validation bound (10,000,000):          ~${(baselineAvg / 4096 * 10_000_000).toFixed(0)} ms`);

function timeString(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(1)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

const estimatedAuthCount = Math.floor(1000 / (baselineAvg / 4096 * 10_000_000));
console.log(`  Max auths per second @ 10M iterations:           ~${Math.max(estimatedAuthCount, 0)}`);

console.log('\n  Estimated auth times by iteration count:');
for (const iterations of ITERATION_COUNTS) {
  const est = baselineAvg / 4096 * iterations;
  console.log(`    ${String(iterations).padStart(10)} iter  →  ${timeString(est).padStart(8)}`);
}

console.log('\n  Recommendations:');
console.log('    4096      PostgreSQL default  —  fast');
console.log('    10,000    Reasonable minimum  —  ~2.5× baseline');
console.log('    100,000   OWASP minimum       —  ~24×  baseline');
console.log('    310,000   OWASP 2023 rec.     —  ~76×  baseline');
console.log('    1,000,000 Strong but slow     —  ~244× baseline');
console.log('    10,000,000 Current upper bound —  ~2441× baseline (impractical)');
