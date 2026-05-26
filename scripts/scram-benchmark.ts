// scripts/scram-benchmark.ts
// Benchmark SCRAM-SHA-256 authentication performance at various iteration counts.
//
// Usage: npx tsx scripts/scram-benchmark.ts

import { pbkdf2Sync, createHmac, createHash, randomBytes } from 'node:crypto';

// ─── Constants ────────────────────────────────────────────────────────────────

interface IterationConfig {
  iterations: number;
  samples: number;
  label: string;
}

const ITERATIONS: IterationConfig[] = [
  { iterations: 4_096,     samples: 30,  label: '4096      (PG default)' },
  { iterations: 10_000,    samples: 30,  label: '10000     (min rec.)'    },
  { iterations: 100_000,   samples: 20,  label: '100000    (OWASP min)'   },
  { iterations: 310_000,   samples: 10,  label: '310000    (OWASP 2023)'  },
  { iterations: 1_000_000, samples: 5,   label: '1000000   (strong)'      },
  { iterations: 10_000_000, samples: 2,  label: '10000000  (max bound)'   },
];

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

function bench(fn: () => void, samples: number): { min: number; avg: number; max: number; totalMs: number } {
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
    totalMs: total,
  };
}

function timeString(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

// ─── Header ───────────────────────────────────────────────────────────────────

console.log('='.repeat(95));
console.log('  SCRAM-SHA-256 Authentication Performance Benchmark');
console.log(`  Node.js ${process.version}  |  Password: ${PASSWORD.length} chars  |  Salt: ${SALT.length} bytes`);
console.log('='.repeat(95));

// Warmup at lowest iteration count
console.log('\n  Warming up V8 JIT...');
for (let i = 0; i < WARMUP; i++) {
  pbkdf2Sync(PASSWORD, SALT, 4096, 32, 'sha256');
  scramAuth(PASSWORD, SALT, 4096, NONCE);
}
console.log('  Done.\n');

// ─── PBKDF2-Only ──────────────────────────────────────────────────────────────

console.log('  ── PBKDF2-SHA256 Only ──');
console.log(`  ${'Iterations'.padStart(12)}  |  ${'Samples'.padStart(7)}  |  ${'Avg'.padStart(10)}  |  ${'Min→Max'.padStart(16)}  |  ${'Total'.padStart(8)}`);
console.log('  ' + '-'.repeat(65));

for (const cfg of ITERATIONS) {
  const r = bench(() => {
    pbkdf2Sync(PASSWORD, SALT, cfg.iterations, 32, 'sha256');
  }, cfg.samples);
  console.log(
    `  ${cfg.label.padStart(24)}  |` +
    `  ${String(cfg.samples).padStart(7)}  |` +
    `  ${timeString(r.avg).padStart(10)}  |` +
    `  ${timeString(r.min)} → ${timeString(r.max).padStart(8)}  |` +
    `  ${timeString(r.totalMs).padStart(8)}`
  );
}

// ─── Full SCRAM Auth ──────────────────────────────────────────────────────────

console.log('\n  ── Full SCRAM Auth (PBKDF2 + 3×HMAC + SHA256 + XOR) ──');
console.log(`  ${'Iterations'.padStart(12)}  |  ${'Samples'.padStart(7)}  |  ${'Avg'.padStart(10)}  |  ${'Min→Max'.padStart(16)}  |  ${'Overhead'.padStart(10)}  |  ${'× Baseline'.padStart(10)}`);
console.log('  ' + '-'.repeat(75));

// Get baseline at 4096
const baselineResult = bench(() => {
  scramAuth(PASSWORD, SALT, 4096, NONCE);
}, 30);
const baselineAvg = baselineResult.avg;

let prevAvg = 0;

for (const cfg of ITERATIONS) {
  const r = bench(() => {
    scramAuth(PASSWORD, SALT, cfg.iterations, NONCE);
  }, cfg.samples);

  // Compute PBKDF2-only time at this iteration count to estimate overhead
  const pbkdf2Only = bench(() => {
    pbkdf2Sync(PASSWORD, SALT, cfg.iterations, 32, 'sha256');
  }, Math.min(cfg.samples, 10));

  const overhead = r.avg - pbkdf2Only.avg;
  const xBaseline = (r.avg / baselineAvg).toFixed(1);
  const xPrev = prevAvg > 0 ? (r.avg / prevAvg).toFixed(1) : '-';

  console.log(
    `  ${cfg.label.padStart(24)}  |` +
    `  ${String(cfg.samples).padStart(7)}  |` +
    `  ${timeString(r.avg).padStart(10)}  |` +
    `  ${timeString(r.min)} → ${timeString(r.max).padStart(8)}  |` +
    `  ${timeString(overhead).padStart(10)}  |` +
    `  ×${xBaseline.padStart(8)}`
  );

  prevAvg = r.avg;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(95));
console.log('  SUMMARY');
console.log('='.repeat(95));
console.log(`\n  Auth non-PBKDF2 overhead (3×HMAC + SHA256 + XOR):  ${timeString(baselineResult.avg - bench(() => {
  pbkdf2Sync(PASSWORD, SALT, 4096, 32, 'sha256');
}, 10).avg)}`);
console.log(`  Baseline (4096, PostgreSQL default):              ${timeString(baselineAvg)}`);
console.log();

console.log('  Estimated auth times at each iteration count:');
for (const cfg of ITERATIONS) {
  const est = baselineAvg / 4096 * cfg.iterations;
  console.log(`    ${String(cfg.iterations).padStart(10)}  →  ${timeString(est).padStart(10)}  ${cfg.label.includes('max bound') ? '  ← current upper bound' : ''}`);
}

console.log('\n  Recommendations for validation bounds in wire.ts:');
console.log('    4096       PostgreSQL default  —  1×  baseline  (fast, ~2-4ms)');
console.log('    10,000     Reasonable min       —  ~2.5× baseline');
const owasp100k = baselineAvg / 4096 * 100_000;
console.log(`    100,000    OWASP recommended     —  ~${(100_000/4096).toFixed(0)}× baseline  (${timeString(owasp100k)})`);
const owasp310k = baselineAvg / 4096 * 310_000;
console.log(`    310,000    OWASP 2023 rec.       —  ~${(310_000/4096).toFixed(0)}× baseline  (${timeString(owasp310k)})`);
const oneM = baselineAvg / 4096 * 1_000_000;
console.log(`    1,000,000  Strong but slow       —  ~${(1_000_000/4096).toFixed(0)}× baseline  (${timeString(oneM)})`);
const tenM = baselineAvg / 4096 * 10_000_000;
console.log(`    10,000,000 Current max bound     —  ~${(10_000_000/4096).toFixed(0)}× baseline  (${timeString(tenM)})`);
console.log();
console.log(`  Note: The 10M iteration count at ${timeString(tenM)} per auth would make`);
console.log('  connection establishment impractical — most client timeouts are 5-10s.');
