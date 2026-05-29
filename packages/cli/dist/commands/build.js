// packages/cli/src/commands/build.ts
// `street build` — compiles TypeScript to JavaScript for production.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
export class BuildCommand {
    async execute(ctx) {
        const projectDir = ctx.cwd;
        const tsconfigPath = resolve(projectDir, 'tsconfig.json');
        console.log('[street] Building project for production...\n');
        const startTime = Date.now();
        await this.runTypeScriptCompiler(projectDir, tsconfigPath);
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\n[street] Build completed in ${duration}s`);
        console.log('[street] Output: ./dist/\n');
    }
    runTypeScriptCompiler(projectDir, _tsconfigPath) {
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
                    reject(new Error(`TypeScript compilation failed with exit code ${code}`));
                }
            });
            tsc.on('error', (err) => {
                reject(new Error(`Failed to start TypeScript compiler: ${err.message}`));
            });
        });
    }
}
//# sourceMappingURL=build.js.map