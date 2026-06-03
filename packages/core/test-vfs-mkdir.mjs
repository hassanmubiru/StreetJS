// Try to access the FS via the sqlite3 wasm module using a postRun callback
const m = await import('./dist/database/sqlite/sqlite3-node.mjs');

let emscriptenModule = null;
const sqlite3 = await m.default({
  postRun: [function() {
    // 'this' is the Module, FS is available here  
    emscriptenModule = this;
    console.log('postRun called, FS:', typeof this.FS);
  }]
});

console.log('emscriptenModule:', emscriptenModule !== null, 'has FS:', !!(emscriptenModule && emscriptenModule.FS));

if (emscriptenModule && emscriptenModule.FS) {
  const FS = emscriptenModule.FS;
  try {
    FS.mkdir('/tmp/test-nested-dir');
    console.log('Created /tmp/test-nested-dir in Emscripten FS');
  } catch(e) {
    console.log('mkdir error:', e.message);
  }
  
  try {
    const db = new sqlite3.oo1.DB('/tmp/test-nested-dir/test.db');
    console.log('SUCCESS: Opened nested DB!');
    db.close();
  } catch(e) {
    console.log('Open error:', e.message);
  }
}
