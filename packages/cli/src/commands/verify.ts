// packages/cli/src/commands/verify.ts
// `street verify <capabilityId> -- <command...>` — run a capability's real
// verification command through the zero-dependency CommandRunner from
// @streetjs/core and emit a machine-readable Verification Artifact under the
// standard layout `verification-artifacts/<area>/<capabilityId>.artifact.json`.
//
// The runner (not this command) assigns the status, enforces the 300s timeout,
// and writes the artifact atomically. This command is a thin driver that mirrors
// the executed command's exit code so a failed verification fails CI.
//
// _Design: Verification Artifact subsystem (CLI surface). Requirements: 1.7_

import { resolve } from 'node:path';
import type { CliContext } from '../index.js';

export class VerifyCommand {
  async execute(ctx: CliContext): Promise<void> {
    const core = await import('streetjs');

    const capabilityId = ctx.args.positional[0];
    if (!capabilityId) {
      this.printUsage();
      process.exitCode = 1;
      return;
    }

    // The command to execute comes from the positional tokens after the
    // capability id (everything passed after `-- `), or from --command.
    const positionalCommand = ctx.args.positional.slice(1).join(' ').trim();
    const flagCommand = ctx.args.flags['command'] ? String(ctx.args.flags['command']) : '';
    const command = positionalCommand || flagCommand;
    if (!command) {
      console.error('[street] a command to execute is required (use `-- <command>` or --command)');
      this.printUsage();
      process.exitCode = 1;
      return;
    }

    // Artifact layout: <out>/<area>/ where <area> is the first dotted segment.
    const outRoot = ctx.args.flags['out'] ? String(ctx.args.flags['out']) : 'verification-artifacts';
    const area = capabilityId.split('.')[0];
    const outDir = resolve(ctx.cwd, outRoot, area!);

    const timeoutMs = ctx.args.flags['timeout'] ? Number(ctx.args.flags['timeout']) : undefined;

    const evidenceHints: {
      sourceCode?: boolean;
      passingTests?: boolean;
      documentation?: boolean;
    } = {};
    if (ctx.args.flags['docs']) evidenceHints.documentation = true;
    if (ctx.args.flags['no-source']) evidenceHints.sourceCode = false;
    if (ctx.args.flags['no-tests']) evidenceHints.passingTests = false;

    const runner = new core.CommandRunner();
    const { artifact, path } = await runner.run({
      capabilityId,
      command,
      cwd: ctx.cwd,
      timeoutMs,
      evidenceHints,
      outDir,
    });

    console.log(`[street] verify ${artifact.capabilityId}: ${artifact.status} (exit ${artifact.exitCode})`);
    if (artifact.blockedReason) {
      console.log(`[street]   blocked: ${artifact.blockedReason.kind}/${artifact.blockedReason.missingPrerequisite}`);
    }
    console.log(`[street]   artifact: ${path}`);

    // Mirror the command's exit code so a failed verification fails the step.
    process.exitCode = artifact.exitCode;
  }

  private printUsage(): void {
    console.error(
      '[street] Usage: street verify <capabilityId> [--out <dir>] [--timeout <ms>] ' +
        '[--docs] [--no-source] [--no-tests] -- <command...>',
    );
  }
}
