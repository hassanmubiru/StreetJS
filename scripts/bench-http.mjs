// scripts/bench-http.mjs
// Honest, reproducible HTTP micro-benchmark for the StreetJS core server.
// Measures: cold-start latency (streetApp → listening) and a hello-world
// throughput floor for plain-text and JSON responses.
//
// Run:  npm run build -w packages/core && node scripts/bench-http.mjs
//
// HONESTY NOTES (read before quoting a number):
//  - This is an IN-PROCESS probe: the load client and the server run in the SAME
//    Node process over loopback. It is NOT a tuned load test with a dedicated
//    generator (autocannon/wrk) on a separate machine. Treat the throughput
//    figures as a conservative FLOOR and a regression signal, not a marketing
//    peak. For headline RPS, run a real generator against a deployed instance.
//  - Absolute numbers are environment-dependent (CPU, Node version, load).
//  - No comparison to other frameworks is made here; publish comparisons only
//    with identical method + hardware, and publish the losing runs too.

import os from 'node:os';
import { request } from 'node:http';
import { streetApp } from '../packages/core/dist/index.js';

const TOTAL = Number(process.env.BENCH_REQUESTS ?? 20_000);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 50);

const hw = {
  cpu: os.cpus()[0]?.model, cores: os.cpus().length,
  memGB: +(os.totalmem() / 1e9).toFixed(1), node: process.version,
  platform: `${os.platform()} ${os.release()}`,
};

async function measureColdStart(runs = 5) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const app = streetApp({ port: 0 });
    app.use(async (ctx) => { ctx.json({ ok: true }); });
    await app.listen(0);
    samples.push(performance.now() - t0);
    await app.close();
  }
  return +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2);
}

function hit(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject); req.end();
  });
}

async function probe(port, path, total, concurrency) {
  const t0 = performance.now();
  let done = 0, launched = 0;
  await new Promise((resolve) => {
    const pump = () => {
      while (launched < total && launched - done < concurrency) {
        launched++;
        hit(port, path).catch(() => {}).finally(() => { done++; (done === total) ? resolve() : pump(); });
      }
    };
    pump();
  });
  return Math.round((total / (performance.now() - t0)) * 1000);
}

async function main() {
  const coldStartMs = await measureColdStart();

  const port = 3099;
  const app = streetApp({ port, host: '127.0.0.1' });
  app.use(async (ctx, next) => {
    if (ctx.path === '/json') { ctx.json({ hello: 'world', n: 42, items: [1, 2, 3] }); return; }
    if (ctx.path === '/plain') { ctx.text('ok'); return; }
    await next();
  });
  await app.listen(port, '127.0.0.1');
  try {
    await probe(port, '/plain', 2_000, CONCURRENCY); // warmup
    const plainRps = await probe(port, '/plain', TOTAL, CONCURRENCY);
    const jsonRps = await probe(port, '/json', TOTAL, CONCURRENCY);

    console.log('StreetJS core HTTP micro-benchmark (in-process probe)\n');
    console.log(`hardware   : ${hw.cpu} · ${hw.cores} cores · ${hw.memGB} GB`);
    console.log(`runtime    : node ${hw.node} · ${hw.platform}`);
    console.log(`workload   : ${TOTAL.toLocaleString()} requests @ concurrency ${CONCURRENCY}\n`);
    console.log(`cold start (streetApp → listening, avg of 5)  ${coldStartMs} ms`);
    console.log(`plain-text throughput (floor)                 ${plainRps.toLocaleString()} req/sec`);
    console.log(`json throughput (floor)                       ${jsonRps.toLocaleString()} req/sec`);
    console.log('\nFloor, not peak: in-process loopback probe. Use a dedicated load generator for headline RPS.');
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
