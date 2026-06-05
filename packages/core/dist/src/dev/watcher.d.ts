export interface WatcherOptions {
    /** Directory to watch for TypeScript source changes. Default: './src' */
    srcDir: string;
    /** Output directory produced by tsc. Default: './dist' */
    outDir: string;
    /** Milliseconds to wait for in-flight requests to drain before killing the
     *  previous server process. Default: 5000 */
    drainTimeoutMs: number;
    /** Compiled entry-point to spawn as the server process. Default: './dist/main.js' */
    entrypoint: string;
}
export declare class DevWatcher {
    private readonly opts;
    /** All FSWatcher handles accumulated during start(); closed in stop().
     *  The primary recursive watcher is always the first element when active. */
    private readonly watcherHandles;
    /** Currently running server child process. */
    private serverProcess;
    /** Guards against concurrent recompile races. */
    private compiling;
    /** Debounce timer – collapses rapid successive saves into one recompile. */
    private debounceTimer;
    private readonly DEBOUNCE_MS;
    constructor(opts: WatcherOptions);
    /**
     * Start the watcher:
     *  1. Perform an initial compilation.
     *  2. Boot the server if compilation succeeded.
     *  3. Begin watching srcDir for .ts file changes.
     */
    start(): Promise<void>;
    /**
     * Stop the watcher:
     *  1. Cancel any pending debounce.
     *  2. Close all FSWatcher handles.
     *  3. Kill the server process.
     */
    stop(): Promise<void>;
    /**
     * Debounce rapid file-save events into a single recompile attempt.
     */
    private scheduleRecompile;
    /**
     * Called (debounced) on each detected .ts change.
     * Skipped if a compilation is already in progress.
     */
    private onFileChanged;
    /**
     * Run `tsc --incremental` as a child process.
     * Streams stdout/stderr to the terminal.
     *
     * @returns `true` on exit code 0, `false` otherwise.
     *          When compilation fails the previous server is intentionally kept
     *          running so the developer can continue to use it.
     */
    compile(): Promise<boolean>;
    /**
     * Send SIGTERM to the running server process, wait up to `drainTimeoutMs`
     * for it to exit gracefully, then SIGKILL if still alive.  Finally spawn a
     * fresh process from `opts.entrypoint`.
     */
    restartServer(): Promise<void>;
    /**
     * Gracefully terminate the current server process.
     * Sends SIGTERM and waits up to `drainTimeoutMs`; falls back to SIGKILL.
     */
    private killServerProcess;
}
//# sourceMappingURL=watcher.d.ts.map