import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';

const workerPath = '/home/error51/Downloads/street-framework/street/packages/core/dist/database/sqlite/worker.js';
const dbPath = join(tmpdir(), `concurrent-raw-${Date.now()}.db`);

async function createAndWait(id) {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerPath, { workerData: { filePath: dbPath } });
    let ready = false;
    w.on('message', (m) => {
      if (m.type === 'ready') {
        ready = true;
        resolve({ w, id });
      } else {
        // Unexpected
        console.log(`Worker ${id} got non-ready message before being sent query:`, JSON.stringify(m));
      }
    });
    w.on('error', (e) => reject(new Error(`Worker ${id} error: ${e.message}`)));
  });
}

function queryWorker(w, id, sql, params = []) {
  return new Promise((resolve, reject) => {
    const msgId = id * 100 + 1;
    w.on('message', (m) => {
      if (m.type === 'ready') return; // skip ready
      if (m.id !== msgId) return;
      if (m.ok) resolve(m.result);
      else reject(new Error(m.error));
    });
    w.postMessage({ id: msgId, type: 'query', sql, params });
  });
}

// Step 1: Create table with worker 0
console.log('Creating worker 0...');
const { w: w0 } = await createAndWait(0);

await queryWorker(w0, 0, 'CREATE TABLE t (id INTEGER, val INTEGER)');
console.log('Created table via w0');

for (let i = 0; i < 5; i++) {
  await queryWorker(w0, i + 1, 'INSERT INTO t VALUES (?, ?)', [i, i * 2]);
}
console.log('Inserted 5 rows via w0');

// Step 2: Now create 2 new workers and have them query simultaneously
console.log('Creating workers 1 and 2 simultaneously...');
const [{ w: w1 }, { w: w2 }] = await Promise.all([createAndWait(1), createAndWait(2)]);
console.log('Both workers ready');

// Query from all 3 workers simultaneously
const results = await Promise.all([
  queryWorker(w0, 10, 'SELECT COUNT(*) AS cnt FROM t').then(r => { console.log('w0 result:', r.rows[0]); return r; }).catch(e => { console.error('w0 error:', e.message); throw e; }),
  queryWorker(w1, 11, 'SELECT COUNT(*) AS cnt FROM t').then(r => { console.log('w1 result:', r.rows[0]); return r; }).catch(e => { console.error('w1 error:', e.message); throw e; }),
  queryWorker(w2, 12, 'SELECT COUNT(*) AS cnt FROM t').then(r => { console.log('w2 result:', r.rows[0]); return r; }).catch(e => { console.error('w2 error:', e.message); throw e; }),
]);

console.log('All queries done');

await w0.terminate();
await w1.terminate();
await w2.terminate();

if (existsSync(dbPath)) unlinkSync(dbPath);
process.exit(0);
