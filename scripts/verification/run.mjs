#!/usr/bin/env node
// scripts/verification/run.mjs
//
// Generic capability verification runner. Drives the zero-dependency
// `CommandRunner` from @streetjs/core to execute a single capability's real
// verification command and emit one machine-readable Verification Artifact.
//
// The artifact is written under the standard layout:
//
//     verification-artifacts/<area>/<capabilityId>.artifact.json
//
// where `<area>` is the first dotted segment of the capability identifier
// (e.g. `cloud.deploy.kubernetes` → area `cloud`). The runner — not this
// script — assigns the status (NOT_IMPLEMENTED → BLOCKED → VERIFIED → PARTIAL),
// enforces the 300s timeout, and writes the artifact atomically (Requirement
// 1.7). This script is a thin, CI-friendly driver around it.
//
// Usage:
//   node scripts/verification/run.mjs <capabilityId> [options] -- <command...>
//   node scripts/verification/run.mjs <capabilityId> --command "<command>" [options]
//
// Options:
//   --command <cmd>     Command to execute (alternative to the `-- <command>` form)
//   --out <dir>         Artifact root directory (default: verification-artifacts)
//   --cwd <dir>         Working directory for the command (default: process.cwd())
//   --timeout <ms>      Command timeout in milliseconds (default: 300000)
//   --docs              Mark the `documentation` evidence component present
//   --no-source         Mark the capability as having no source code
//   --no-tests          Force the `passingTests` evidence component absent
//
// Exit code: mirrors the executed command's exit code, so a failed verification
// fails the CI step (Requirement 1.9).
//
// _Design: Verification Artifact subsystem (CLI surface); package layout
//  (scripts/verification/run.mjs). Requirements: 1.7_

import { resolve } from 'node:path';
import { CommandRunner } from 'streetjs';

/**
 * Parse the script argv into a capability id, the command to run, and options.
 * Everything after a bare `--` is taken verbatim as the command + its args.
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    capabilityId: undefined,
    command: undefined,
    outRoot: 'verification-artifacts',
    cwd: process.cwd(),
    timeoutMs: undefined,
    evidenceHints: {},
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--') {
      // Everything after `--` is the command and its arguments.
      const rest = args.slice(i + 1);
      if (rest.length > 0) opts.command = rest.join(' ');
      break;
    }

    if (arg === '--command') {
      opts.command = args[++i];
    } else if (arg === '--out') {
      opts.outRoot = args[++i];
    } else if (arg === '--cwd') {
      opts.cwd = args[++i];
    } else if (arg === '--timeout') {
      opts.timeoutMs = Number(args[++i]);
    } else if (arg === '--docs') {
      opts.evidenceHints.documentation = true;
    } else if (arg === '--no-source') {
      opts.evidenceHints.sourceCode = false;
    } else if (arg === '--no-tests') {
      opts.evidenceHints.passingTests = false;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (opts.capabilityId === undefined) {
      opts.capabilityId = arg;
    } else {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
    i++;
  }

  return opts;
}

/**
 * Derive the artifact output directory for a capability under the standard
 * layout: `<outRoot>/<area>` where `<area>` is the first dotted segment.
 */
export function artifactOutDir(outRoot, capabilityId) {
  const area = capabilityId.split('.')[0];
  return resolve(outRoot, area);
}

/**
 * Drive the CommandRunner for one capability and return the run result.
 */
export async function runCapability(opts) {
  const outDir = artifactOutDir(opts.outRoot, opts.capabilityId);
  const runner = new CommandRunner();
  return runner.run({
    capabilityId: opts.capabilityId,
    command: opts.command,
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    evidenceHints: opts.evidenceHints,
    outDir,
  });
}

function usage() {
  console.error(
    'Usage: node scripts/verification/run.mjs <capabilityId> [--out <dir>] ' +
      '[--cwd <dir>] [--timeout <ms>] [--docs] [--no-source] [--no-tests] -- <command...>',
  );
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(`[verify] ${err.message}`);
    usage();
    process.exitCode = 1;
    return;
  }

  if (!opts.capabilityId) {
    console.error('[verify] a <capabilityId> is required');
    usage();
    process.exitCode = 1;
    return;
  }
  if (!opts.command) {
    console.error('[verify] a command to execute is required (use `-- <command>` or --command)');
    usage();
    process.exitCode = 1;
    return;
  }

  const { artifact, path } = await runCapability(opts);

  console.log(`[verify] ${artifact.capabilityId}: ${artifact.status} (exit ${artifact.exitCode})`);
  if (artifact.blockedReason) {
    console.log(`[verify]   blocked: ${artifact.blockedReason.kind}/${artifact.blockedReason.missingPrerequisite}`);
  }
  console.log(`[verify]   artifact: ${path}`);

  // Mirror the command's exit code so a failed verification fails the step.
  process.exitCode = artifact.exitCode;
}

// Only run when invoked directly (not when imported by a test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[verify] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
