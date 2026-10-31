#!/usr/bin/env node
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const wasmDir = path.join(dist, 'database', 'sqlite');

fs.mkdirSync(wasmDir, { recursive: true });
for (const f of ['sqlite3.wasm', 'sqlite3-node.mjs']) {
  fs.copyFileSync(
    path.join(__dirname, '..', 'src', 'database', 'sqlite', f),
    path.join(wasmDir, f)
  );
}

const entries = [
  path.join(dist, 'index.js'),
  path.join(dist, 'http', 'server.js'),
  path.join(dist, 'router', 'router.js'),
  path.join(dist, 'database', 'wire.js'),
];

const external = ['reflect-metadata', 'ws', 'zod'];

for (const entry of entries) {
  const dir = path.dirname(entry);
  const base = path.basename(entry, '.js');
  const outFile = path.join(dir, base + '.bundled.js');

  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    external,
    outfile: outFile,
    write: true,
  });

  // Replace original with bundled version
  fs.unlinkSync(entry);
  fs.renameSync(outFile, entry);
}

console.log('Bundle complete');
