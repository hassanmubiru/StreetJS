// packages/cli/src/commands/start.ts
// `street start` — runs the compiled production server.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
export class StartCommand {
    async execute(ctx) {
        const projectDir = ctx.cwd;
        const distDir = resolve(projectDir, 'dist');
        const mainFile = join(distDir, 'main.js');
        // Verify build exists
        if (!existsSync(mainFile)) {
            console.error('[street] Build not found. Run "street build" first.');
            process.exitCode = 1;
            return;
        }
        console.log('[street] Starting production server...\n');
        console.log(`[street] Node env: ${process.env['NODE_ENV'] ?? 'production'}\n`);
        const server = spawn('node', [mainFile], {
            stdio: 'inherit',
            env: {
                ...process.env,
                NODE_ENV: process.env['NODE_ENV'] ?? 'production',
            },
        });
        server.on('exit', (code) => {
            if (code !== null && code !== 0) {
                console.error(`[street] Server exited with code ${code}`);
            }
            process.exit(code ?? 0);
        });
        server.on('error', (err) => {
            console.error(`[street] Failed to start server: ${err.message}`);
            process.exit(1);
        });
        // Forward termination signals
        const cleanup = () => {
            if (!server.killed) {
                server.kill('SIGTERM');
            }
        };
        process.once('SIGTERM', cleanup);
        process.once('SIGINT', cleanup);
    }
}
//# sourceMappingURL=start.js.map