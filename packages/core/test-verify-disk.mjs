import { Worker } from 'node:worker_threads';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const workerPath = '/home/error51/Downloads/street-framework/street/packages/core/dist/database/sqlite/worker.js';
const dbPath = join(tmpdir(), `verify-disk-${Date.now()}.db`);

async function createWorkerAndWait() {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerPath, { workerData: { filePath: dbPath } });
    w.on('message', (m) => {
      if (m.type === 'ready') resolve(w);
    });
    w.on('error', reject);
  });
}

function query(w, id, sql, params = []) {
  return new Promise((resolve, reject) => {
    w.on('message', (m) => {
      if (m.type === 'ready') return;
      if (m.id !== id) return;
      if (m.ok) resolve(m.result);
      else reject(new Error(m.error));
    });
    w.postMessage({ id, type: 'query', sql, params });
  });
}

// Create table via worker 0
const w0 = await createWorkerAndWait();
await query(w0, 1, 'CREATE TABLE t (id INTEGER)');
await query(w0, 2, 'INSERT INTO t VALUES (1), (2), (3)');
await w0.terminate();

console.log('Worker 0 terminated. File exists:', existsSync(dbPath));

// Now check the file with the sqlite3 CLI (if available)
try {
  const { stdout } = await execAsync(`sqlite3 ${dbPath} "SELECT COUNT(*) FROM t"`);
  console.log('Real sqlite3 CLI sees:', stdout.trim(), 'rows');
} catch(e) {
  console.log('sqlite3 CLI not available or error:', e.message);
}

// Now open with worker 1
const w1 = await createWorkerAndWait();
try {
  const r = await query(w1, 10, 'SELECT COUNT(*) FROM t');
  console.log('Worker 1 sees:', r.rows[0], 'via WASM');
} catch(e) {
  console.error('Worker 1 error:', e.message);
}
await w1.terminate();

console.log('Done');
process.exit(0);
