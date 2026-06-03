const m = await import('./dist/database/sqlite/sqlite3-node.mjs');

// Try to get the module's FS by examining what's exposed
const sqlite3 = await m.default();

// Look for FS in the wasm pstack or other hidden properties
console.log('sqlite3.wasm keys filtered:', Object.keys(sqlite3.wasm).filter(k => k.toLowerCase().includes('fs') || k.toLowerCase().includes('file')).join(', '));

// Look at capi for FS-related functions
const fsKeys = Object.keys(sqlite3.capi).filter(k => k.includes('file') || k.includes('FS') || k.includes('vfs') || k.includes('mkdir'));
console.log('capi FS keys:', fsKeys.slice(0, 20).join(', '));

// Try accessing the module via global
console.log('global Module:', typeof globalThis.Module);

// Check the actual syscall implementation
const syscallKeys = Object.keys(sqlite3.wasm.exports).filter(k => k.includes('syscall') || k.includes('mkdir'));
console.log('syscall exports:', syscallKeys.join(', '));
