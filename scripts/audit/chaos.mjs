// Chaos engineering: inject a database outage by restarting the Postgres
// container, then verify the StreetJS pool RECOVERS (queries succeed again),
// measure recovery time, and confirm no socket leak afterwards. Skips cleanly
// (exit 0, marked SKIP) when docker or the target container is unavailable.
//
//   CHAOS_DB_CONTAINER=street_test_pg node scripts/audit/chaos.mjs
//
import { spawnSync } from 'node:child_process';
import { PgPool } from 'streetjs';

const CONTAINER = process.env.CHAOS_DB_CONTAINER ?? 'street_test_pg';
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' });

function dockerAvailable() {
  const r = sh('docker', ['ps', '--format', '{{.Names}}']);
  return r.status === 0 && r.stdout.split('\n').includes(CONTAINER);
}

if (!dockerAvailable()) {
  console.log(`SKIP: docker or container "${CONTAINER}" not available — chaos test not run.`);
  process.exit(0);
}

const pool = new PgPool({
  host: '127.0.0.1', port: Number(process.env.PG_PORT ?? 5433),
  user: 'street', password: 'street_secret', database: 'street_test',
  minConnections: 2, maxConnections: 5, idleTimeoutMs: 5_000, acquireTimeoutMs: 3_000,
});

const openSockets = () => process._getActiveHandles().filter((h) => h?.constructor?.name === 'Socket').length;

async function tryQuery() {
  try { const r = await pool.query('SELECT 1 AS one'); return Number(r.rows[0].one) === 1; }
  catch { return false; }
}

await pool.initialize();
console.log('pre-chaos query:', (await tryQuery()) ? 'OK' : 'FAIL');

// ── Inject fault: restart Postgres ─────────────────────────────────────────────
console.log(`injecting fault: docker restart ${CONTAINER}`);
const restart = sh('docker', ['restart', CONTAINER]);
if (restart.status !== 0) { console.log('SKIP: could not restart container.'); process.exit(0); }

// Expect failure immediately after restart (connection dropped).
const duringOutage = await tryQuery();

// ── Recovery: poll until queries succeed again ─────────────────────────────────
const t0 = Date.now();
const DEADLINE_MS = 60_000;
let recovered = false;
while (Date.now() - t0 < DEADLINE_MS) {
  await new Promise((r) => setTimeout(r, 1000));
  if (await tryQuery()) { recovered = true; break; }
}
const recoveryMs = Date.now() - t0;

// Stability after recovery: run several queries.
let postOk = 0;
for (let i = 0; i < 5; i++) if (await tryQuery()) postOk++;

const before = openSockets();
await pool.close();
// Allow extra settle time: a reconnect storm can leave sockets mid-close briefly.
await new Promise((r) => setTimeout(r, 4000));
const remaining = process._getActiveHandles().filter((h) => h?.constructor?.name === 'Socket');
const leaked = remaining.length;
if (leaked > 0) {
  console.log('post-close socket detail:', remaining.map((s) => ({
    destroyed: s.destroyed, readable: s.readable, writable: s.writable, pending: s.pending,
  })));
}

console.log(`during-outage query succeeded unexpectedly: ${duringOutage ? 'yes' : 'no (expected)'}`);
console.log(`recovered: ${recovered} in ~${(recoveryMs / 1000).toFixed(1)}s | post-recovery queries ${postOk}/5 | sockets after close: ${leaked}`);

const fail = [];
if (!recovered) fail.push('pool did NOT recover after DB restart');
if (postOk < 5) fail.push(`post-recovery instability (${postOk}/5)`);
if (leaked > 0) fail.push(`socket leak after close (${leaked})`);
console.log(fail.length === 0 ? 'RESULT: CHAOS pg-restart ✅ (graceful recovery, no leak)' : `RESULT: CHAOS ❌ — ${fail.join('; ')}`);
process.exit(fail.length === 0 ? 0 : 1);
