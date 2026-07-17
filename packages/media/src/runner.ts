// src/runner.ts
// Default CommandRunner backed by node:child_process. Injected into
// MediaProcessor so production shells out to real binaries while tests use a fake.

import { spawn } from 'node:child_process';
import type { CommandResult, CommandRunner } from './types.js';

/** Runs a binary with argv (never a shell), capturing stdout/stderr. */
export class NodeCommandRunner implements CommandRunner {
  run(command: string, args: string[]): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      // `shell: false` (the default) means args are passed as a real argv,
      // so values never go through a shell — no command injection surface.
      const child = spawn(command, args, { shell: false });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf8'); });
      child.stderr?.on('data', (c: Buffer) => { stderr += c.toString('utf8'); });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    });
  }
}
