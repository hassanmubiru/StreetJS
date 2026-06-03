// Try to use the wasm module to create directories
const m = await import('./dist/database/sqlite/sqlite3-node.mjs');

const sqlite3 = await m.default();
const capi = sqlite3.capi;
const wasm = sqlite3.wasm;

// Approach: use the wasm xCall to call the syscall_mkdirat directly
// This creates a directory in the Emscripten FS
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Create the dir on real disk first
const dir = join(tmpdir(), 'nested-wasm-test');
try { mkdirSync(dir); } catch {}

// Now we need to make the Emscripten FS aware of it
// Try wasm.xCall to call __syscall_mkdirat
try {
  // Check what xCall looks like
  console.log('wasm xCall:', typeof wasm.xCall);
  if (typeof wasm.xCall === 'function') {
    // __syscall_mkdirat(dirfd=-100=AT_FDCWD, path, mode=0777)
    const rc = wasm.xCall('__syscall_mkdirat', -100, dir, 0o777);
    console.log('__syscall_mkdirat rc:', rc);
    
    const db = new sqlite3.oo1.DB(join(dir, 'test.db'));
    console.log('SUCCESS: Opened nested DB!');
    db.close();
  }
} catch(e) {
  console.log('xCall approach error:', e.message);
}

// Alternative: try using sqlite3__wasm_vfs_create_file to create an empty file (parent must exist)
// Another alternative: use path without subdirectory
console.log('\nFallback: flat path in /tmp');
try {
  const db = new sqlite3.oo1.DB(join(tmpdir(), 'flat-test.db'));
  console.log('Flat /tmp path OK');
  db.close();
} catch(e) {
  console.log('Flat path error:', e.message);
}
