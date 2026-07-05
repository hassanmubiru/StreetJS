// scripts/bench-pillars.mjs
// Additive micro-benchmark harness for StreetJS pillar in-memory hot paths.
// CPU/allocation-bound paths only — no external services. Produces ops/sec and
// ns/op with a warmup phase. Run: node scripts/bench-pillars.mjs
//
// This is a lightweight, deterministic harness (no external bench deps). It is
// intentionally conservative: it measures pure/in-memory public-API hot paths so
// results are reproducible on any machine. Absolute numbers are environment
// dependent; use it to catch regressions and to characterize relative cost.

import { performance } from 'node:perf_hooks';
import { resolveVersion } from '@streetjs/gateway';
import { createMemoryEvents } from '@streetjs/events';
import { createRealtime, FakeConnection } from '@streetjs/realtime';
import { StreetWebSocketServer } from 'streetjs';

/** Time `fn` over `iters` iterations after `warmup` iterations; report ops/sec. */
async function bench(label, iters, warmup, fn) {
  for (let i = 0; i < warmup; i++) await fn(i);
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn(i);
  const ms = performance.now() - t0;
  const opsSec = (iters / ms) * 1000;
  const nsOp = (ms * 1e6) / iters;
  console.log(
    `${label.padEnd(42)} ${iters.toLocaleString().padStart(10)} iters  ` +
    `${opsSec.toFixed(0).padStart(12)} ops/sec  ${nsOp.toFixed(1).padStart(10)} ns/op`,
  );
}

async function main() {
  console.log('StreetJS pillar micro-benchmarks (in-memory hot paths)\n');
  console.log(`node ${process.version}\n`);

  // ── gateway: pure API version resolution ────────────────────────────────
  const policy = {
    sources: ['path', 'x-version', 'accept-version'],
    versions: ['v1', 'v2', 'v3'],
    default: 'v1',
  };
  const req = { method: 'GET', url: '/v2/users?full=1', path: '/v2/users', headers: {} };
  await bench('gateway resolveVersion (path hit)', 1_000_000, 50_000, () => {
    resolveVersion(policy, req);
  });

  // ── events: publish fan-out to N in-memory listeners ────────────────────
  for (const N of [1, 10, 100]) {
    const events = createMemoryEvents();
    let sink = 0;
    for (let i = 0; i < N; i++) events.on('bench.event', (p) => { sink += p.n; });
    await bench(`events publish → ${N} listeners`, 100_000, 5_000, async (i) => {
      await events.publish('bench.event', { n: i });
    });
    if (sink < 0) console.log('unreachable', sink);
  }

  // ── realtime: broadcast fan-out to N connections (MemoryAdapter) ────────
  for (const N of [10, 100]) {
    const server = new StreetWebSocketServer();
    const rt = createRealtime({ server });
    const room = rt.room('bench');
    // Ensure adapter readiness before timing (avoids racing init()).
    await room.presence();
    for (let i = 0; i < N; i++) {
      await room.join({ id: `m${i}` }, new FakeConnection({ id: `c${i}` }));
    }
    await bench(`realtime broadcast → ${N} connections`, 50_000, 2_000, async () => {
      await room.broadcast({ type: 'msg', payload: { t: 'x' } });
    });
    await rt.close();
  }

  console.log('\nDone. (Absolute numbers are environment-dependent; use for regression tracking.)');
}

main().catch((err) => { console.error('benchmark failed:', err); process.exit(1); });
