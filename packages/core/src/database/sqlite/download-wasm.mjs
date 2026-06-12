#!/usr/bin/env node
/**
 * SQLite WASM binary download + integrity verification.
 *
 * Downloads the official pre-built SQLite WebAssembly binary (`sqlite3.wasm`)
 * from the `@sqlite.org/sqlite-wasm` npm package, served via the jsDelivr CDN,
 * and places it at packages/core/src/database/sqlite/sqlite3.wasm.
 *
 * The expected SHA-256 of the binary is pinned below (EXPECTED_SHA256). Every
 * download is verified against it, and the binary that ships in the repo can be
 * audited against the official upstream release at any time:
 *
 *   # Verify the committed binary matches the pinned official hash:
 *   node packages/core/src/database/sqlite/download-wasm.mjs --verify
 *
 *   # (Re)download and verify (run after bumping the pinned version/hash):
 *   node packages/core/src/database/sqlite/download-wasm.mjs --force
 *
 * Package: https://www.npmjs.com/package/@sqlite.org/sqlite-wasm
 * Version: 3.47.2-build1 (SQLite 3.47.2)
 * Source:  https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.47.2-build1/sqlite-wasm/jswasm/sqlite3.wasm
 *
 * Only `sqlite3.wasm` is handled here. The Emscripten JS glue
 * (`sqlite3-node.mjs`) comes from the same package's `jswasm/` directory and is
 * committed alongside this script.
 */
import { createReadStream, createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { get } from 'node:https';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, 'sqlite3.wasm');

// Official SQLite WASM build — sqlite3.wasm from the @sqlite.org/sqlite-wasm npm
// package. The version and its pinned SHA-256 MUST be updated together.
const WASM_VERSION = '3.47.2-build1';
const WASM_URL = `https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@${WASM_VERSION}/sqlite-wasm/jswasm/sqlite3.wasm`;
const EXPECTED_SHA256 = '246fd886c2989ccc7959ca415f9fbb0daa01b0d99d7c8ef9f9fa37c68c345584';

const args = new Set(process.argv.slice(2));
const verifyOnly = args.has('--verify');
const force = args.has('--force');

/** Compute the SHA-256 of a file as a lowercase hex string. */
async function sha256OfFile(path) {
  const hash = createHash('sha256');
  await pipeline(
    createReadStream(path),
    new Writable({ write(chunk, _enc, cb) { hash.update(chunk); cb(); } }),
  );
  return hash.digest('hex');
}

async function fetchUrl(url, redirectCount = 0) {
  if (redirectCount > 5) throw new Error('Too many redirects');
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(fetchUrl(res.headers.location, redirectCount + 1));
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

// ── --verify: audit the committed binary against the pinned hash ──────────────
if (verifyOnly) {
  if (!existsSync(WASM_PATH)) {
    console.error(`::error::sqlite3.wasm not found at ${WASM_PATH}`);
    process.exit(1);
  }
  const actual = await sha256OfFile(WASM_PATH);
  if (actual !== EXPECTED_SHA256) {
    console.error(`::error::sqlite3.wasm SHA-256 mismatch — expected ${EXPECTED_SHA256}, got ${actual}`);
    process.exit(1);
  }
  console.log(`sqlite3.wasm verified against official @sqlite.org/sqlite-wasm@${WASM_VERSION} (sha256 ${EXPECTED_SHA256})`);
  process.exit(0);
}

// ── default / --force: (re)download, then verify against the pinned hash ──────
if (existsSync(WASM_PATH) && !force) {
  const actual = await sha256OfFile(WASM_PATH);
  if (actual === EXPECTED_SHA256) {
    console.log('sqlite3.wasm already present and verified at:', WASM_PATH);
    process.exit(0);
  }
  console.error(`::error::existing sqlite3.wasm SHA-256 mismatch — expected ${EXPECTED_SHA256}, got ${actual}`);
  console.error('Re-run with --force to overwrite with the official binary.');
  process.exit(1);
}

console.log('Downloading SQLite WASM binary...');
console.log('URL:', WASM_URL);
console.log('Destination:', WASM_PATH);

try {
  const res = await fetchUrl(WASM_URL);
  await pipeline(res, createWriteStream(WASM_PATH));

  const actual = await sha256OfFile(WASM_PATH);
  if (actual !== EXPECTED_SHA256) {
    unlinkSync(WASM_PATH);
    console.error(`::error::downloaded sqlite3.wasm SHA-256 mismatch — expected ${EXPECTED_SHA256}, got ${actual}`);
    process.exit(1);
  }
  console.log('SHA-256:', actual, '(verified)');
  console.log('Download complete:', WASM_PATH);
} catch (err) {
  if (existsSync(WASM_PATH)) {
    try { unlinkSync(WASM_PATH); } catch { /* ignore */ }
  }
  console.error('Download failed:', err.message);
  process.exit(1);
}
