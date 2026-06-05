// src/diagnostics/socket-server.ts
// DiagnosticsServer: pushes live route and memory stats over a Unix domain socket.
import { createServer } from 'node:net';
import { unlink, access } from 'node:fs/promises';
export class DiagnosticsServer {
    _socketPath;
    _profiler;
    _server = null;
    _clients = new Set();
    _pushTimer = null;
    constructor(opts) {
        this._socketPath = opts.socketPath ?? `/tmp/street-${process.pid}.sock`;
        this._profiler = opts.profiler;
    }
    /** Start listening on the Unix domain socket and push snapshots every second. */
    start() {
        if (this._server)
            return;
        const server = createServer((socket) => {
            this._clients.add(socket);
            socket.on('close', () => this._clients.delete(socket));
            socket.on('error', () => this._clients.delete(socket));
            // Send an immediate snapshot when a client connects
            this._pushSnapshot(socket);
        });
        this._server = server;
        server.listen(this._socketPath, () => {
            // Socket is listening
        });
        server.on('error', (err) => {
            console.error('[diagnostics] Socket server error:', err.message);
        });
        // Push snapshot to all connected clients every second
        this._pushTimer = setInterval(() => {
            this._broadcastSnapshot();
        }, 1000);
        this._pushTimer.unref();
    }
    /** Stop the server, close all clients, and remove the socket file. */
    stop() {
        if (this._pushTimer) {
            clearInterval(this._pushTimer);
            this._pushTimer = null;
        }
        for (const client of this._clients) {
            try {
                client.destroy();
            }
            catch { /* ignore */ }
        }
        this._clients.clear();
        if (this._server) {
            this._server.close();
            this._server = null;
        }
        // Remove the socket file (best-effort)
        unlink(this._socketPath).catch(() => undefined);
    }
    // ── Private helpers ─────────────────────────────────────────────────────────
    _snapshot() {
        const allStats = {};
        for (const [key, stats] of this._profiler.allStats()) {
            allStats[key] = stats;
        }
        const mem = process.memoryUsage();
        const payload = {
            ts: new Date().toISOString(),
            routes: allStats,
            memory: {
                heapUsed: mem.heapUsed,
                heapTotal: mem.heapTotal,
                rss: mem.rss,
                external: mem.external,
            },
        };
        return JSON.stringify(payload) + '\n';
    }
    _pushSnapshot(socket) {
        try {
            if (!socket.destroyed)
                socket.write(this._snapshot());
        }
        catch { /* ignore write errors */ }
    }
    _broadcastSnapshot() {
        const snapshot = this._snapshot();
        for (const client of this._clients) {
            try {
                if (!client.destroyed)
                    client.write(snapshot);
            }
            catch {
                this._clients.delete(client);
            }
        }
    }
}
/** Check if a given socket path is stale (process no longer running). */
export async function isStaleSocket(socketPath) {
    // Extract PID from filename like /tmp/street-12345.sock
    const match = socketPath.match(/street-(\d+)\.sock$/);
    if (!match)
        return false;
    const pid = parseInt(match[1], 10);
    if (isNaN(pid))
        return false;
    // Check if file exists
    try {
        await access(socketPath);
    }
    catch {
        return false; // file doesn't exist — not stale
    }
    // Check if process is alive
    try {
        process.kill(pid, 0);
        return false; // process is alive
    }
    catch {
        return true; // process is dead — socket is stale
    }
}
//# sourceMappingURL=socket-server.js.map