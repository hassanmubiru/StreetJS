// packages/cli/src/commands/verify.ts
// `street verify <capabilityId> -- <command...>` — run a capability's real
// verification command through the zero-dependency CommandRunner from
// @streetjs/core and emit a machine-readable Verification Artifact under the
// standard layout `verification-artifacts/<area>/<capabilityId>.artifact.json`.
//
// `street verify --aggregate` — read every recorded Verification Artifact under
// `verification-artifacts/`, drive the exit-criteria aggregator
// (`computeLeadership`), and persist its output to
// `verification-artifacts/platform-leadership.report.json`. The Platform
// Leadership decision is computed SOLELY by the aggregator from the recorded
// artifacts (Req 12.4) — this command never authors, sets, or edits the
// decision; it only persists `computeLeadership()`'s return value verbatim and
// mirrors the computed GRANTED/WITHHELD decision in its exit code.
//
// The runner (not this command) assigns each capability's status, enforces the
// 300s timeout, and writes the artifact atomically. This command is a thin
// driver that mirrors the executed command's exit code so a failed verification
// fails CI.
//
// _Design: Verification Artifact subsystem (CLI surface); Exit-criteria engine.
//  Architecture → Artifact directory layout. Requirements: 1.7, 12.4, 12.5_

import { resolve, join, sep } from 'node:path';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import type { CliContext } from '../index.js';
import type { VerificationArtifact } from 'streetjs';

/** File name the aggregator's report is persisted under (Req 12.5). */
const REPORT_FILENAME = 'platform-leadership.report.json';
/** Suffix that marks a file as a recorded Verification Artifact. */
const ARTIFACT_SUFFIX = '.artifact.json';

export class VerifyCommand {
  async execute(ctx: CliContext): Promise<void> {
    const core = await import('streetjs');

    // `--aggregate` switches from running a single capability's command to
    // computing the Platform Leadership decision from recorded artifacts.
    if (ctx.args.flags['aggregate']) {
      await this.executeAggregate(ctx, core);
      return;
    }

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

  /**
   * `street verify --aggregate`: read every recorded Verification Artifact
   * under the artifact root, hand them to the aggregator, and persist its
   * output (Req 12.4/12.5). The decision is never computed here — the CLI only
   * loads artifacts, calls `computeLeadership`, and writes the returned report.
   */
  private async executeAggregate(
    ctx: CliContext,
    core: typeof import('streetjs'),
  ): Promise<void> {
    const outRoot = ctx.args.flags['out'] ? String(ctx.args.flags['out']) : 'verification-artifacts';
    const rootDir = resolve(ctx.cwd, outRoot);

    if (!existsSync(rootDir)) {
      console.error(`[street] verify --aggregate: artifact directory not found: ${rootDir}`);
      process.exitCode = 1;
      return;
    }

    // Read and validate every recorded artifact under the root, pairing each
    // with the path it was read from for the report's `computedFrom` provenance.
    const sources: Array<{ artifact: VerificationArtifact; path: string }> = [];
    for (const filePath of this.collectArtifactFiles(rootDir)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch (err) {
        console.error(
          `[street]   skipping unreadable artifact ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      const { valid, errors } = core.validateArtifact(parsed);
      if (!valid) {
        console.error(`[street]   skipping invalid artifact ${filePath}: ${errors.join('; ')}`);
        continue;
      }
      sources.push({ artifact: parsed as VerificationArtifact, path: filePath });
    }

    // The aggregator is the ONLY thing that computes the decision (Req 12.4).
    const report = core.computeLeadership(sources);

    // Persist the aggregator's output verbatim to the report file. The report
    // sits at the artifact root (Req 12.5). Written atomically so a reader never
    // observes a partial report.
    const reportPath = join(rootDir, REPORT_FILENAME);
    this.writeReportAtomic(reportPath, report);

    console.log(`[street] verify --aggregate: ${report.decision}`);
    for (const cap of report.required) {
      const marker = cap.status === 'VERIFIED' ? '✓' : '✗';
      const missing = cap.hasArtifact ? '' : ' (no artifact)';
      console.log(`[street]   ${marker} ${cap.capabilityId}: ${cap.status}${missing}`);
    }
    console.log(`[street]   report: ${reportPath}`);

    // `--advisory` makes the run visibility-only: the decision is still computed
    // SOLELY by the aggregator and persisted verbatim (nothing above changes),
    // but the process exits 0 regardless of GRANTED/WITHHELD. This is for
    // contexts where the per-capability artifacts are legitimately absent
    // because their producing workflows do not run on this event (e.g. a pull
    // request) — a WITHHELD there reflects "not evaluated in this context", not
    // "failed", so it must not block. The strict gate (below) is unchanged for
    // main/scheduled/release/dispatch runs, where the artifacts do exist and a
    // real WITHHELD must fail — so the zero-trust guarantee (Req 12.3/12.4) is
    // preserved wherever it is meaningful; advisory mode never lets a genuine
    // WITHHELD pass on those authoritative events.
    if (ctx.args.flags['advisory']) {
      if (report.decision !== 'GRANTED') {
        console.log(
          '[street]   advisory mode: decision is WITHHELD but this run is ' +
            'non-blocking (artifacts for some capabilities are not produced on ' +
            'this event). Exiting 0. See docs/platform-leadership.md.',
        );
      }
      process.exitCode = 0;
      return;
    }

    // The exit code reflects — but does not set — the computed decision so a
    // CI gate fails when leadership is withheld.
    process.exitCode = report.decision === 'GRANTED' ? 0 : 1;
  }

  /**
   * Recursively collect every `*.artifact.json` file under `rootDir`. The
   * aggregator's own report file is never treated as an input.
   */
  private collectArtifactFiles(rootDir: string): string[] {
    const entries = readdirSync(rootDir, { recursive: true, withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(ARTIFACT_SUFFIX)) continue;
      // `parentPath` (Node ≥20.12) / `path` (older) holds the containing dir.
      const dir = (entry as unknown as { parentPath?: string; path?: string }).parentPath
        ?? (entry as unknown as { path?: string }).path
        ?? rootDir;
      files.push(join(dir, entry.name));
    }
    // Deterministic order keeps `computedFrom` provenance stable across runs.
    return files.sort();
  }

  /** Write the report atomically: tmp file then rename over the target. */
  private writeReportAtomic(reportPath: string, report: unknown): void {
    const dir = reportPath.slice(0, reportPath.lastIndexOf(sep));
    mkdirSync(dir, { recursive: true });
    const tmpPath = `${reportPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
    writeFileSync(tmpPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, reportPath);
  }

  private printUsage(): void {
    console.error(
      '[street] Usage: street verify <capabilityId> [--out <dir>] [--timeout <ms>] ' +
        '[--docs] [--no-source] [--no-tests] -- <command...>\n' +
        '[street]        street verify --aggregate [--out <dir>]',
    );
  }
}
