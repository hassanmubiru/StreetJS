import { Worker } from 'node:worker_threads';

const w = new Worker('/home/error51/Downloads/street-framework/street/packages/core/dist/database/sqlite/worker.js', {
  workerData: { filePath: ':memory:' }
});

w.on('error', (e) => { console.error('Worker error:', e.message, e.stack); });
w.on('message', (m) => { console.log('Worker message:', JSON.stringify(m)); });
w.on('exit', (code) => { console.log('Worker exit code:', code); });

await new Promise(r => setTimeout(r, 3000));
console.log('Sending query...');
w.postMessage({ id: 1, type: 'query', sql: 'SELECT 1 AS n', params: [] });
await new Promise(r => setTimeout(r, 3000));
await w.terminate();
process.exit(0);
