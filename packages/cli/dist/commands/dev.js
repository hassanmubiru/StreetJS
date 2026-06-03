// packages/cli/src/commands/dev.ts
// `street dev` — compiles TypeScript and starts the server with file watching.
//
// When `--watch` is passed (or `DEV_WATCH=true` is set in the environment)
// the command delegates to `DevWatcher` from `@streetjs/core`, which handles
// incremental compilation, server restart, and graceful shutdown.
//
// Without `--watch` the command falls back to the original one-shot build +
// server start behaviour.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { watch } from 'node:fs/promises';
import { DevWatcher } from '@streetjs/core';
export class DevCommand {
    childProcess = null;
    abortController = new AbortController();
    async execute(ctx) {
        const projectDir = ctx.cwd;
        // ── Watch mode: delegate to DevWatcher ──────────────────────────────────
        const watchFlagPresent = ctx.args.flags['watch'] === true ||
            ctx.args.flags['w'] === true ||
            process.env['DEV_WATCH'] === 'true';
        if (watchFlagPresent) {
            await this.runWithDevWatcher(projectDir);
            return;
        }
        // ── Legacy one-shot mode ─────────────────────────────────────────────────
        await this.runLegacy(projectDir);
    }
    // ── DevWatcher-based mode ──────────────────────────────────────────────────
    async runWithDevWatcher(projectDir) {
        const watcher = new DevWatcher({
            srcDir: resolve(projectDir, 'src'),
            outDir: resolve(projectDir, 'dist'),
            drainTimeoutMs: 5000,
            entrypoint: resolve(projectDir, 'dist', 'main.js'),
        });
        // Register signal handlers before start() so they are in place even if
        // start() is blocked on initial compilation.
        const onSignal = () => {
            watcher.stop().then(() => {
                process.exit(0);
            }).catch(() => {
                process.exit(1);
            });
        };
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);
        await watcher.start();
        // Keep the process alive — DevWatcher uses fs.watch() internally which
        // keeps the event loop active, but we hold an explicit ref here for
        // clarity.  The signal handlers above are the exit path.
    }
    // ── Legacy one-shot mode ───────────────────────────────────────────────────
    async runLegacy(projectDir) {
        const distDir = resolve(projectDir, 'dist');
        const srcDir = resolve(projectDir, 'src');
        console.log('[street] Starting development server...\n');
        // Perform initial build
        await this.compile(projectDir);
        // Start the server
        await this.startServer(distDir);
        // Watch for file changes
        console.log('[street] Watching for file changes...\n');
        this.watchSource(srcDir, projectDir, distDir);
        // Handle process termination
        const cleanup = () => {
            this.abortController.abort();
            this.killServer();
            process.exit(0);
        };
        process.once('SIGTERM', cleanup);
        process.once('SIGINT', cleanup);
    }
    compile(projectDir) {
        return new Promise((resolvePromise, reject) => {
            const tsc = spawn('npx', ['tsc', '--project', 'tsconfig.json'], {
                cwd: projectDir,
                stdio: 'inherit',
                shell: true,
            });
            tsc.on('close', (code) => {
                if (code === 0) {
                    resolvePromise();
                }
                else {
                    // TypeScript errors during initial compilation are fatal
                    reject(new Error(`TypeScript compilation failed with exit code ${code}`));
                }
            });
            tsc.on('error', (err) => {
                reject(new Error(`Failed to start TypeScript compiler: ${err.message}`));
            });
        });
    }
    async startServer(distDir) {
        const mainFile = resolve(distDir, 'main.js');
        return new Promise((resolvePromise, reject) => {
            this.childProcess = spawn('node', [mainFile], {
                stdio: 'inherit',
                env: {
                    ...process.env,
                    NODE_ENV: 'development',
                },
            });
            // Give the server a moment to start
            this.childProcess.on('spawn', () => {
                setTimeout(resolvePromise, 500);
            });
            this.childProcess.on('error', (err) => {
                reject(new Error(`Failed to start server: ${err.message}`));
            });
            this.childProcess.on('exit', (code) => {
                if (code !== null && code !== 0 && this.childProcess !== null) {
                    console.error(`[street] Server exited with code ${code}`);
                }
            });
        });
    }
    killServer() {
        if (this.childProcess && !this.childProcess.killed) {
            this.childProcess.kill('SIGTERM');
            this.childProcess = null;
        }
    }
    async watchSource(srcDir, projectDir, distDir) {
        try {
            const watcher = watch(srcDir, { recursive: true, signal: this.abortController.signal });
            // Debounce recompilation
            let timeoutId = null;
            for await (const event of watcher) {
                if (event.filename === null)
                    continue;
                // Debounce: wait 300ms after last change before recompiling
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                }
                timeoutId = setTimeout(async () => {
                    console.log(`[street] File changed: ${event.filename}`);
                    console.log('[street] Recompiling...');
                    try {
                        await this.compile(projectDir);
                        this.killServer();
                        await this.startServer(distDir);
                        console.log('[street] Reload complete. Watching for changes...\n');
                    }
                    catch (err) {
                        console.error('[street] Compilation error:', err instanceof Error ? err.message : String(err));
                        console.log('[street] Fix the error and save again.\n');
                    }
                }, 300);
            }
        }
        catch (err) {
            // If the signal was aborted, this is expected on shutdown
            if (err?.code !== 'ABORT_ERR') {
                console.error('[street] Watch error:', err);
            }
        }
    }
}
//# sourceMappingURL=dev.js.map