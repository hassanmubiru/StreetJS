// src/database/sqlite/worker.ts
// SQLite worker — runs inside a node:worker_threads thread.
//
// Loads the SQLite WASM binary (via the official @sqlite.org/sqlite-wasm
// Emscripten JS glue) and handles `query` / `transaction` messages sent from
// the main thread via MessageChannel ports.
//
// Message protocol:
//   Request  → { id, type: 'query',       sql, params? }
//            → { id, type: 'transaction',  ops: Array<{ sql, params? }> }
//   Response ← { id, ok: true,  result: DbResult }
//            ← { id, ok: false, error:  string   }
import { workerData, isMainThread, parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Derive the SQL command tag from the first token of the statement.
 * Mirrors the PostgreSQL CommandComplete tag for API consistency.
 */
function commandTag(sql) {
    const token = sql.trimStart().split(/\s+/)[0];
    return token ? token.toUpperCase() : 'UNKNOWN';
}
/**
 * Normalise a row returned by SQLite OO1 exec (rowMode: 'object') to the
 * `Record<string, string | null>` shape required by `DbResult`.
 */
function normaliseRow(row) {
    const out = {};
    for (const [key, val] of Object.entries(row)) {
        if (val === null || val === undefined) {
            out[key] = null;
        }
        else {
            out[key] = String(val);
        }
    }
    return out;
}
/**
 * Execute a single SQL statement against an open DB, returning a `DbResult`.
 */
function execOne(db, sql, params) {
    const rows = [];
    const opts = { rowMode: 'object', resultRows: rows };
    if (params && params.length > 0) {
        opts.bind = params;
    }
    db.exec(sql, opts);
    const normalisedRows = rows.map(normaliseRow);
    const cmd = commandTag(sql);
    // For DML statements (INSERT/UPDATE/DELETE) use db.changes(); for
    // everything else (SELECT, DDL …) use the number of returned rows.
    let rowCount;
    if (cmd === 'INSERT' || cmd === 'UPDATE' || cmd === 'DELETE') {
        rowCount = db.changes();
    }
    else {
        rowCount = normalisedRows.length;
    }
    return { rows: normalisedRows, rowCount, command: cmd };
}
// ─── Worker bootstrap ─────────────────────────────────────────────────────────
if (!isMainThread) {
    const { filePath } = workerData;
    // Resolve the WASM glue module relative to this worker file.
    // In the compiled output the file lives next to the JS glue wrapper.
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const gluePath = join(__dirname, 'sqlite3-node.mjs');
    // The glue module is a plain ESM file that imports `node:fs`, `node:path`,
    // etc. via require() internally.  We make `require` available on globalThis
    // for the rare case the WASM module needs it (Emscripten MODULARIZE build).
    const _require = createRequire(import.meta.url);
    globalThis['require'] = _require;
    // Dynamically import the glue code and open the database.
    let db = null;
    const glue = await import(gluePath);
    const sqlite3 = await glue.default({
        // Tell the Emscripten runtime where to find sqlite3.wasm
        locateFile: (name) => join(__dirname, name),
    });
    db = new sqlite3.oo1.DB(filePath);
    parentPort.on('message', (req) => {
        if (!db) {
            const resp = { id: req.id, ok: false, error: 'Database is closed' };
            parentPort.postMessage(resp);
            return;
        }
        let resp;
        try {
            if (req.type === 'query') {
                const result = execOne(db, req.sql, req.params);
                resp = { id: req.id, ok: true, result };
            }
            else {
                // transaction — run all ops atomically; return result of last op
                let lastResult = { rows: [], rowCount: 0, command: 'BEGIN' };
                db.transaction(() => {
                    for (const op of req.ops) {
                        lastResult = execOne(db, op.sql, op.params);
                    }
                });
                resp = { id: req.id, ok: true, result: lastResult };
            }
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            resp = { id: req.id, ok: false, error: msg };
        }
        parentPort.postMessage(resp);
    });
    // Close the database cleanly when the worker is told to exit.
    parentPort.on('close', () => {
        if (db) {
            try {
                db.close();
            }
            catch { /* ignore */ }
            db = null;
        }
    });
}
//# sourceMappingURL=worker.js.map