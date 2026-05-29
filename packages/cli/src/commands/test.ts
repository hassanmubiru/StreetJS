// packages/cli/src/commands/test.ts
// `street test` — runs the project's test suite using Node's built-in test runner.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import type { CliContext } from '../index.js';

export class TestCommand {
  async execute(ctx: CliContext): Promise<void> {
    const projectDir = ctx.cwd;

    // First, compile TypeScript so tests can import .js extensions
    console.log('[street] Compiling TypeScript for tests...\n');

    try {
      await this.compile(projectDir);
    } catch {
      console.error('[street] TypeScript compilation failed. Fix errors and try again.');
      process.exitCode = 1;
      return;
    }

    // Discover test files in dist/tests/
    const testDir = resolve(projectDir, 'dist', 'tests');
    let testFiles: string[];

    try {
      testFiles = (await readdir(testDir))
        .filter((f) => f.endsWith('.test.js'))
        .sort();
    } catch {
      // No test directory -> look in tests/ directory
      const sourceTestDir = resolve(projectDir, 'tests');
      try {
        testFiles = (await readdir(sourceTestDir))
          .filter((f) => f.endsWith('.test.ts'))
          .sort()
          .map((f) => f.replace(/\.ts$/, '.js'));
      } catch {
        testFiles = [];
      }
    }

    if (testFiles.length === 0) {
      console.log('[street] No test files found.');
      return;
    }

    console.log(`[street] Running ${testFiles.length} test file(s)...\n`);

    // Use Node's --test runner with the compiled JS files
    const testPaths = testFiles.map((f) => resolve(testDir ?? resolve(projectDir, 'dist/tests'), f));

    return new Promise((resolvePromise, reject) => {
      const runner = spawn('node', ['--test', ...testPaths], {
        cwd: projectDir,
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'test',
        },
      });

      runner.on('close', (code) => {
        if (code === 0) {
          console.log('\n[street] All tests passed.');
          resolvePromise();
        } else {
          console.error(`\n[street] Tests failed with exit code ${code}`);
          process.exitCode = code ?? 1;
          resolvePromise();
        }
      });

      runner.on('error', (err) => {
        reject(new Error(`Failed to run tests: ${err.message}`));
      });
    });
  }

  private compile(projectDir: string): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      const tsc = spawn('npx', ['tsc', '--project', 'tsconfig.json'], {
        cwd: projectDir,
        stdio: 'inherit',
        shell: true,
      });

      tsc.on('close', (code) => {
        if (code === 0) {
          resolvePromise();
        } else {
          reject(new Error(`TypeScript compilation failed with exit code ${code}`));
        }
      });

      tsc.on('error', (err) => {
        reject(new Error(`Failed to start TypeScript compiler: ${err.message}`));
      });
    });
  }
}
