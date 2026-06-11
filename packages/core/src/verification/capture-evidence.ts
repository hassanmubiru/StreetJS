// packages/core/src/verification/capture-evidence.ts
// Zero-Trust evidence-capture orchestration script (R1.2, R1.3, R1.4, R12.5).
//
// This script runs every consumer-platform capability's real verification step
// through the existing zero-dependency `CommandRunner` and writes one atomic
// `<capabilityId>.artifact.json` per capability under the standard layout
// `verification-artifacts/<area>/`. Crucially, it NEVER authors, sets, or edits
// a status by hand: it only hands a real command (build, `node --test`, lint,
// example run) to `CommandRunner.run({ capabilityId, command, evidenceHints,
// outDir })`, which spawns the process, derives the four evidence components,
// calls the pure `classify()` engine, and persists the artifact atomically. The
// resulting VERIFIED/PARTIAL/BLOCKED/NOT_IMPLEMENTED status therefore derives
// SOLELY from executed-command output (R1.3, R12.5).
//
// `sourceCode` and `documentation` are the only two evidence components the
// runner cannot infer from a command's exit code; this script supplies them as
// `evidenceHints` derived from real filesystem existence checks (not asserted
// constants) so they too reflect ground truth. `passingTests` is left to the
// runner, which derives it from the executed command's exit code.
//
// The capability set is the frozen `CONSUMER_PLATFORM_CAPABILITIES` from
// `certification.ts`, so the orchestration and the scorecard share one source
// of truth and every capability the Zero-Trust Standard applies to is covered.
//
// Running (after `npm run build` of @streetjs/core and the dating packages):
//   node dist/verification/capture-evidence.js
//   node dist/verification/capture-evidence.js --only validation.runtime,upload.guard
//   node dist/verification/capture-evidence.js --list
//
// _Requirements: 1.2, 1.3, 1.4, 12.5_

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CommandRunner } from './runner.js';
import type { RunResult } from './runner.js';
import { CONSUMER_PLATFORM_CAPABILITIES } from './certification.js';

/**
 * A single capability's verification plan. The `command` is the real,
 * executed verification step for the capability (build / `node --test` / lint /
 * example run); the runner turns its exit code into the artifact's status.
 */
export interface CapabilityPlan {
  /** Dotted capability id; the artifact's `capabilityId` and file stem. */
  capabilityId: string;
  /** The shell command executed via {@link CommandRunner.run}. */
  command: string;
  /** Working directory the command is executed in. */
  cwd: string;
  /** Absolute path to a source file whose presence evidences `sourceCode`. */
  sourcePath: string;
  /** Absolute path to a doc file whose presence evidences `documentation`. */
  docPath: string;
  /** Optional per-capability timeout override (ms). */
  timeoutMs?: number;
}

/** Options controlling where plans resolve paths and where artifacts land. */
export interface CaptureOptions {
  /** Root of the `@streetjs/core` package (where `dist/` and `src/` live). */
  coreDir: string;
  /** Monorepo root (parent of `packages/`). */
  repoRoot: string;
  /** Directory the artifacts are written under (default `verification-artifacts`). */
  outRoot?: string;
  /** Restrict the run to this subset of capability ids (default: all). */
  only?: readonly string[];
  /** Injected runner (default: a fresh {@link CommandRunner}). */
  runner?: CommandRunner;
  /** Optional logger; defaults to `console`. */
  logger?: Pick<Console, 'log' | 'error'>;
}

/** The result of capturing evidence for a single capability. */
export interface CaptureResult {
  capabilityId: string;
  status: RunResult['artifact']['status'];
  exitCode: number;
  path: string;
}

/** The chained `node --test` command for a core capability's compiled tests. */
function coreTestCommand(testFiles: readonly string[]): string {
  const targets = testFiles.map((f) => `dist/tests/${f}`).join(' ');
  return `node --test ${targets}`;
}

/**
 * Build the default capability plans from the frozen capability set. Each core
 * capability runs its compiled feature tests; each dating-package capability
 * runs the package's own `test` and `example` scripts (build + `node --test` +
 * example run). Source/doc paths are resolved to absolute locations so the
 * existence-derived evidence hints reflect real files.
 */
export function defaultCapabilityPlans(opts: CaptureOptions): CapabilityPlan[] {
  const { coreDir, repoRoot } = opts;
  const coreSrc = (rel: string): string => resolve(coreDir, 'src', rel);
  const repoDoc = resolve(repoRoot, 'docs', 'security', 'consumer-platform.md');

  /** A core-package capability rooted at `coreDir`. */
  const core = (
    capabilityId: string,
    testFiles: readonly string[],
    sourceRel: string,
  ): CapabilityPlan => ({
    capabilityId,
    command: coreTestCommand(testFiles),
    cwd: coreDir,
    sourcePath: coreSrc(sourceRel),
    docPath: repoDoc,
  });

  /** A dating reference package capability rooted at its package dir. */
  const dating = (capabilityId: string, pkgDir: string): CapabilityPlan => {
    const cwd = resolve(repoRoot, 'packages', pkgDir);
    return {
      capabilityId,
      // Build + run tests, then run the runnable example (R1: tests + example).
      command: 'npm test && npm run example',
      cwd,
      sourcePath: join(cwd, 'src', 'index.ts'),
      docPath: join(cwd, 'README.md'),
    };
  };

  const plans: Record<string, CapabilityPlan> = {
    'validation.runtime': core(
      'validation.runtime',
      [
        'validation.test.js',
        'validation-determinism-pbt.test.js',
        'validation-rejection-pbt.test.js',
        'validation-safe-rejection-pbt.test.js',
        'validation-startup-secrecy-pbt.test.js',
      ],
      'security/validation.ts',
    ),
    'ratelimit.sliding-window': core(
      'ratelimit.sliding-window',
      [
        'ratelimit-sliding-window-pbt.test.js',
        'ratelimit-window-parsing-pbt.test.js',
        'ratelimit-scopes.test.js',
        'store.test.js',
      ],
      'security/ratelimit.ts',
    ),
    'headers.defaults': core(
      'headers.defaults',
      ['headers-set-invariance-pbt.test.js', 'security-headers-defaults.test.js'],
      'security/headers.ts',
    ),
    'upload.guard': core(
      'upload.guard',
      [
        'upload-guard.test.js',
        'upload-oversize-rejection-pbt.test.js',
        'upload-type-enforcement-pbt.test.js',
        'upload-exif-strip-pbt.test.js',
        'upload-malware-persistence-pbt.test.js',
        'upload-stored-filename-pbt.test.js',
      ],
      'multipart/upload-guard.ts',
    ),
    'encryption.field': core(
      'encryption.field',
      [
        'encryption-roundtrip-pbt.test.js',
        'encryption-key-rotation-pbt.test.js',
        'tamper-detection-pbt.test.js',
      ],
      'security/encrypted-field.ts',
    ),
    'abuse.engine': core(
      'abuse.engine',
      [
        'abuse-login-lockout-pbt.test.js',
        'abuse-signup-throttle-pbt.test.js',
        'abuse-password-spray-pbt.test.js',
        'abuse-score.test.js',
      ],
      'security/abuse.ts',
    ),
    'moderation.toolkit': core(
      'moderation.toolkit',
      [
        'moderation-apis.test.js',
        'moderation-audit-immutability-pbt.test.js',
        'moderation-mute-scoping-pbt.test.js',
      ],
      'security/moderation.ts',
    ),
    'secrets.provider': core(
      'secrets.provider',
      ['secret-provider-adapters.test.js'],
      'security/secret-provider.ts',
    ),
    'privacy.controls': core(
      'privacy.controls',
      [
        'privacy-consent-pbt.test.js',
        'privacy-deletion-pbt.test.js',
        'privacy-retention-pbt.test.js',
      ],
      'security/privacy.ts',
    ),
    'dating.auth': dating('dating.auth', 'dating-auth'),
    'dating.profiles': dating('dating.profiles', 'dating-profiles'),
    'dating.messaging': dating('dating.messaging', 'dating-messaging'),
    'dating.moderation': dating('dating.moderation', 'dating-moderation'),
  };

  // Drive the order off the frozen capability set so coverage is exhaustive and
  // the orchestration shares one source of truth with the scorecard.
  return CONSUMER_PLATFORM_CAPABILITIES.filter((id) => id in plans).map(
    (id) => plans[id]!,
  );
}

/** Resolve the artifact output directory for a capability: `<outRoot>/<area>/`. */
function outDirFor(repoRoot: string, outRoot: string, capabilityId: string): string {
  const area = capabilityId.split('.')[0] ?? capabilityId;
  const root = isAbsolute(outRoot) ? outRoot : resolve(repoRoot, outRoot);
  return join(root, area);
}

/**
 * Capture Zero-Trust evidence for the planned capabilities. For each plan the
 * real command is executed through {@link CommandRunner.run}; the runner writes
 * one atomic `<capabilityId>.artifact.json` whose status derives from the
 * command's exit code (R1.3, R12.5). `sourceCode`/`documentation` hints are
 * derived from filesystem existence so they reflect ground truth rather than an
 * asserted constant. Returns the per-capability outcome list.
 */
export async function captureEvidence(opts: CaptureOptions): Promise<CaptureResult[]> {
  const logger = opts.logger ?? console;
  const runner = opts.runner ?? new CommandRunner();
  const outRoot = opts.outRoot ?? 'verification-artifacts';

  const all = defaultCapabilityPlans(opts);
  const selected = opts.only && opts.only.length > 0
    ? all.filter((p) => opts.only!.includes(p.capabilityId))
    : all;

  const results: CaptureResult[] = [];
  for (const plan of selected) {
    const outDir = outDirFor(opts.repoRoot, outRoot, plan.capabilityId);

    // Only the two facts the runner cannot infer from an exit code are supplied
    // as hints, and even these are derived from real filesystem existence.
    const evidenceHints = {
      sourceCode: existsSync(plan.sourcePath),
      documentation: existsSync(plan.docPath),
    };

    logger.log(`[capture] ${plan.capabilityId}: ${plan.command} (cwd ${plan.cwd})`);
    const { artifact, path } = await runner.run({
      capabilityId: plan.capabilityId,
      command: plan.command,
      cwd: plan.cwd,
      evidenceHints,
      outDir,
      ...(plan.timeoutMs !== undefined ? { timeoutMs: plan.timeoutMs } : {}),
    });

    const marker = artifact.status === 'VERIFIED' ? '✓' : '✗';
    logger.log(
      `[capture]   ${marker} ${artifact.status} (exit ${artifact.exitCode}) → ${path}`,
    );
    if (artifact.blockedReason) {
      logger.log(
        `[capture]     blocked: ${artifact.blockedReason.kind}/${artifact.blockedReason.missingPrerequisite}`,
      );
    }

    results.push({
      capabilityId: plan.capabilityId,
      status: artifact.status,
      exitCode: artifact.exitCode,
      path,
    });
  }

  return results;
}

/**
 * Locate the `@streetjs/core` package directory by walking up from a starting
 * directory until a `package.json` named `streetjs` is found. Robust to the two
 * compiled layouts (`dist/verification/` and `dist/src/verification/`).
 */
function findCoreDir(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        // Avoid a JSON import assertion; a cheap synchronous read is enough.
        const { name } = JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string };
        if (name === 'streetjs') return dir;
      } catch {
        /* keep walking up on parse/read errors */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the start directory; callers may override via --core.
  return startDir;
}

/** Parse a comma/space-separated `--only` / `--core` / `--repo` / `--out` argv. */
function parseArgs(argv: readonly string[]): {
  only?: string[];
  coreDir?: string;
  repoRoot?: string;
  outRoot?: string;
  list: boolean;
} {
  const out: { only?: string[]; coreDir?: string; repoRoot?: string; outRoot?: string; list: boolean } = {
    list: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') out.list = true;
    else if (arg === '--only') out.only = (argv[++i] ?? '').split(/[ ,]+/).filter(Boolean);
    else if (arg === '--core') out.coreDir = argv[++i];
    else if (arg === '--repo') out.repoRoot = argv[++i];
    else if (arg === '--out') out.outRoot = argv[++i];
  }
  return out;
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2));

  const coreDir = args.coreDir ? resolve(args.coreDir) : findCoreDir(scriptDir);
  const repoRoot = args.repoRoot ? resolve(args.repoRoot) : resolve(coreDir, '..', '..');
  const opts: CaptureOptions = {
    coreDir,
    repoRoot,
    ...(args.outRoot ? { outRoot: args.outRoot } : {}),
    ...(args.only ? { only: args.only } : {}),
  };

  if (args.list) {
    console.log('Capability plans:');
    for (const plan of defaultCapabilityPlans(opts)) {
      console.log(`  ${plan.capabilityId.padEnd(28)} ${plan.command}`);
    }
    return;
  }

  console.log('\n🔒 Street Framework — Zero-Trust evidence capture');
  console.log(`   core: ${coreDir}`);
  console.log(`   repo: ${repoRoot}`);
  console.log('─'.repeat(72));

  const results = await captureEvidence(opts);

  const verified = results.filter((r) => r.status === 'VERIFIED').length;
  console.log('─'.repeat(72));
  console.log(`Captured ${results.length} artifact(s); ${verified} VERIFIED.`);

  // Mirror — but never set — the aggregate outcome in the exit code so a CI
  // gate fails when any captured command failed.
  const anyFailed = results.some((r) => r.exitCode !== 0);
  process.exitCode = anyFailed ? 1 : 0;
}

// Run as a script when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
