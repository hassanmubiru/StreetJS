import type { RouteProfiler } from './route-profiler.js';
export interface DiagnosticsServerOptions {
    /** Path to the Unix domain socket (default: /tmp/street-<pid>.sock) */
    socketPath?: string;
    /** RouteProfiler instance to snapshot */
    profiler: RouteProfiler;
}
export declare class DiagnosticsServer {
    private readonly _socketPath;
    private readonly _profiler;
    private _server;
    private readonly _clients;
    private _pushTimer;
    constructor(opts: DiagnosticsServerOptions);
    /** Start listening on the Unix domain socket and push snapshots every second. */
    start(): void;
    /** Stop the server, close all clients, and remove the socket file. */
    stop(): void;
    private _snapshot;
    private _pushSnapshot;
    private _broadcastSnapshot;
}
/** Check if a given socket path is stale (process no longer running). */
export declare function isStaleSocket(socketPath: string): Promise<boolean>;
//# sourceMappingURL=socket-server.d.ts.map