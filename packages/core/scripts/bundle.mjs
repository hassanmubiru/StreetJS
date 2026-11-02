#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const dist = join(__dirname, '..', 'dist');
const wasmDir = join(dist, 'database', 'sqlite');

mkdirSync(wasmDir, { recursive: true });
for (const f of ['sqlite3.wasm', 'sqlite3-node.mjs']) {
  copyFileSync(
    join(__dirname, '..', 'src', 'database', 'sqlite', f),
    join(wasmDir, f)
  );
}

const entries = [
  join(dist, 'index.js'),
  join(dist, 'http', 'server.js'),
  join(dist, 'router', 'router.js'),
  join(dist, 'database', 'wire.js'),
];

// Keep runtime deps and worker-thread files external so import.meta.url
// in files that use new Worker() resolves correctly at runtime.
const external = [
  'reflect-metadata',
  'ws',
  'zod',
  // SQLite WASM pool spawns a worker thread; import.meta.url must resolve
  // relative to pool.js's real location, not the bundled entry point.
  './database/sqlite/pool.js',
  './database/sqlite/worker.js',
  // All @streetjs/* sub-packages are declared dependencies and must stay
  // as external imports so their own import.meta.url paths work correctly.
  '@streetjs/*',
];

for (const entry of entries) {
  const dir = dirname(entry);
  const base = basename(entry, '.js');
  const outFile = join(dir, base + '.bundled.js');

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    external,
    outfile: outFile,
    write: true,
  });

  // Replace original with bundled version
  unlinkSync(entry);
  renameSync(outFile, entry);
}

console.log('Bundle complete');
