// Scaled load + memory-stability + startup/shutdown-cycle probe. NOT a full soak
// (see report: 1h/10k-RPS/1000-WS marked UNTESTED). Bounded proxy: N requests at
// fixed concurrency against a live server, tracking errors and RSS drift, then
// repeated listen/close cycles to surface per-cycle handle/memory leaks.
import { streetApp } from 'streetjs';

const PORT = 31988, BASE = `http://127.0.0.1:${PORT}`;
const N = Number(process.env.N ?? 5000);
const CONC = Number(process.env.CONC ?? 50);

function makeApp(port = PORT) {
  const app = streetApp({ port });
  app.use(async (ctx, next) => {
    if (ctx.path === '/ping') { ctx.json({ ok: true, t: Date.now() }); return; }
    await next();
  });
  return app;
}

const mb = (b) => Math.round(b / 1048576);

// ── Load phase ───────────────────────────────────────────────────────────────
const app = makeApp();
await app.listen(PORT, '127.0.0.1');

// warm-up
for (let i = 0; i < 100; i++) await fetch(`${BASE}/ping`).then((r) => r.arrayBuffer());
global.gc?.();
const rssStart = process.memoryUsage().rss;

let ok = 0, errors = 0;
const t0 = Date.now();
let i = 0;
async function worker() {
  while (i < N) {
    i++;
    try {
      const r = await fetch(`${BASE}/ping`);
      if (r.status === 200) { ok++; await r.arrayBuffer(); } else errors++;
    } catch { errors++; }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
const ms = Date.now() - t0;
global.gc?.();
const rssEnd = process.memoryUsage().rss;

console.log(`requests=${N} concurrency=${CONC} ok=${ok} errors=${errors} ` +
  `rps=${Math.round((N / ms) * 1000)} durationMs=${ms}`);
console.log(`rss start=${mb(rssStart)}MB end=${mb(rssEnd)}MB drift=${mb(rssEnd - rssStart)}MB`);
await app.close();

// ── Repeated startup/shutdown cycles ──────────────────────────────────────────
global.gc?.();
const rssCycleStart = process.memoryUsage().rss;
for (let c = 0; c < 20; c++) {
  const cyclePort = 32000 + c;             // fresh port per cycle: avoids undici
  const a = makeApp(cyclePort);            // reusing a keep-alive socket to a
  await a.listen(cyclePort, '127.0.0.1');  // just-restarted server (client artifact)
  await fetch(`http://127.0.0.1:${cyclePort}/ping`, { headers: { connection: 'close' } })
    .then((r) => r.arrayBuffer());
  await a.close();
}
global.gc?.();
const rssCycleEnd = process.memoryUsage().rss;
const sockets = process._getActiveHandles().filter((h) => h?.constructor?.name === 'Socket').length;
console.log(`cycles=20 rssDrift=${mb(rssCycleEnd - rssCycleStart)}MB leftoverSockets=${sockets}`);

const errorRateOk = errors === 0;
const memOk = mb(rssEnd - rssStart) < 50 && mb(rssCycleEnd - rssCycleStart) < 50;
const handlesOk = sockets === 0;
console.log(`RESULT errors=${errorRateOk ? 'OK' : 'FAIL'} memory=${memOk ? 'OK' : 'WATCH'} handles=${handlesOk ? 'OK' : 'WATCH'}`);
process.exit(errorRateOk && handlesOk ? 0 : 1);
