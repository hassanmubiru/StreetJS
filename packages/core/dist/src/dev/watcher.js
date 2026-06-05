// src/dev/watcher.ts
// Hot-reload development watcher: watches .ts source files, triggers incremental
// TypeScript compilation, and restarts the server process on success.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
export class DevWatcher {
    opts;
    /** All FSWatcher handles accumulated during start(); closed in stop().
     *  The primary recursive watcher is always the first element when active. */
    watcherHandles = [];
    /** Currently running server child process. */
    serverProcess = null;
    /** Guards against concurrent recompile races. */
    compiling = false;
    /** Debounce timer – collapses rapid successive saves into one recompile. */
    debounceTimer = null;
    DEBOUNCE_MS = 150;
    constructor(opts) {
        this.opts = opts;
    }
    // ── Public API ──────────────────────────────────────────────────────────────
    /**
     * Start the watcher:
     *  1. Perform an initial compilation.
     *  2. Boot the server if compilation succeeded.
     *  3. Begin watching srcDir for .ts file changes.
     */
    async start() {
        process.stderr.write('[dev] Starting DevWatcher…\n');
        const ok = await this.compile();
        if (ok) {
            await this.restartServer();
        }
        // Attach the recursive watcher and store the handle for cleanup.
        const watcher = watch(this.opts.srcDir, { recursive: true }, (_event, filename) => {
            // Only react to TypeScript source file changes.
            if (typeof filename === 'string' && filename.endsWith('.ts')) {
                this.scheduleRecompile();
            }
        });
        this.watcherHandles.push(watcher);
        process.stderr.write(`[dev] Watching ${this.opts.srcDir} for changes…\n`);
    }
    /**
     * Stop the watcher:
     *  1. Cancel any pending debounce.
     *  2. Close all FSWatcher handles.
     *  3. Kill the server process.
     */
    async stop() {
        process.stderr.write('[dev] Stopping DevWatcher…\n');
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        // Close every FSWatcher handle to prevent listener leaks.
        for (const handle of this.watcherHandles) {
            try {
                handle.close();
            }
            catch {
                // Ignore errors on close — the watcher may already be closed.
            }
        }
        this.watcherHandles.length = 0;
        await this.killServerProcess();
        process.stderr.write('[dev] DevWatcher stopped.\n');
    }
    // ── Private helpers ─────────────────────────────────────────────────────────
    /**
     * Debounce rapid file-save events into a single recompile attempt.
     */
    scheduleRecompile() {
        if (this.debounceTimer !== null) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            void this.onFileChanged();
        }, this.DEBOUNCE_MS);
    }
    /**
     * Called (debounced) on each detected .ts change.
     * Skipped if a compilation is already in progress.
     */
    async onFileChanged() {
        if (this.compiling) {
            process.stderr.write('[dev] Recompile already in progress — skipping.\n');
            return;
        }
        const ok = await this.compile();
        if (ok) {
            await this.restartServer();
        }
    }
    /**
     * Run `tsc --incremental` as a child process.
     * Streams stdout/stderr to the terminal.
     *
     * @returns `true` on exit code 0, `false` otherwise.
     *          When compilation fails the previous server is intentionally kept
     *          running so the developer can continue to use it.
     */
    async compile() {
        if (this.compiling)
            return false;
        this.compiling = true;
        process.stderr.write('[dev] Compiling TypeScript (--incremental)…\n');
        return new Promise((resolve) => {
            const tsc = spawn('npx', ['tsc', '--incremental'], {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false,
            });
            tsc.stdout?.on('data', (chunk) => {
                process.stdout.write(chunk);
            });
            tsc.stderr?.on('data', (chunk) => {
                process.stderr.write(chunk);
            });
            tsc.on('close', (code) => {
                this.compiling = false;
                const success = code === 0;
                if (success) {
                    process.stderr.write('[dev] Compilation succeeded.\n');
                }
                else {
                    process.stderr.write(`[dev] Compilation failed (exit ${code ?? 'null'}) — keeping previous server alive.\n`);
                }
                resolve(success);
            });
            tsc.on('error', (err) => {
                this.compiling = false;
                process.stderr.write(`[dev] Failed to spawn tsc: ${err.message}\n`);
                resolve(false);
            });
        });
    }
    /**
     * Send SIGTERM to the running server process, wait up to `drainTimeoutMs`
     * for it to exit gracefully, then SIGKILL if still alive.  Finally spawn a
     * fresh process from `opts.entrypoint`.
     */
    async restartServer() {
        await this.killServerProcess();
        process.stderr.write(`[dev] Spawning server: node ${this.opts.entrypoint}\n`);
        const child = spawn('node', [this.opts.entrypoint], {
            stdio: 'inherit',
            env: { ...process.env, DEV_WATCH: 'true' },
            shell: false,
        });
        child.on('error', (err) => {
            process.stderr.write(`[dev] Server process error: ${err.message}\n`);
        });
        child.on('exit', (code, signal) => {
            // Only log unexpected exits; a SIGTERM on restart is expected.
            if (signal !== 'SIGTERM' && code !== 0) {
                process.stderr.write(`[dev] Server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'none'}).\n`);
            }
            if (this.serverProcess === child) {
                this.serverProcess = null;
            }
        });
        this.serverProcess = child;
    }
    /**
     * Gracefully terminate the current server process.
     * Sends SIGTERM and waits up to `drainTimeoutMs`; falls back to SIGKILL.
     */
    killServerProcess() {
        const proc = this.serverProcess;
        if (!proc || proc.exitCode !== null || proc.killed) {
            this.serverProcess = null;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const drainMs = this.opts.drainTimeoutMs;
            const forceKillTimer = setTimeout(() => {
                if (!proc.killed) {
                    process.stderr.write('[dev] Drain timeout reached — sending SIGKILL.\n');
                    proc.kill('SIGKILL');
                }
            }, drainMs);
            proc.once('exit', () => {
                clearTimeout(forceKillTimer);
                this.serverProcess = null;
                resolve();
            });
            proc.kill('SIGTERM');
        });
    }
}
//# sourceMappingURL=watcher.js.map