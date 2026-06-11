// packages/core/src/verification/generate-report.ts
// Consumer-Platform Certification Report generator (R1.1, R12.1, R12.2, R12.3,
// R12.4, R12.5).
//
// This script reads the recorded `<capabilityId>.artifact.json` files written
// by the evidence-capture orchestration (`capture-evidence.ts`) from the
// artifact directory, validates each one with the existing zero-dependency
// `validateArtifact`, and hands the recorded artifacts (paired with the path
// each was read from) to the pure `computeCertification` aggregator. The
// eight-category scorecard is therefore derived SOLELY from recorded,
// command-produced artifacts (R12.2/R12.5) — this script never authors, sets,
// or edits a category status or a capability status by hand. A contributing
// capability with no recorded artifact is reported by the aggregator as not
// VERIFIED and listed under its category's `unverified` set (R12.3); each
// category's `computedFrom`/per-capability artifact path is the executed-command
// evidence reference (R12.4).
//
// It emits the Certification Report in two forms:
//   • JSON   — the `CertificationReport` returned by `computeCertification`,
//              written verbatim (atomically) to
//              `<root>/consumer-platform-certification.report.json`.
//   • Human  — a readable scorecard listing each of the eight categories
//              (R12.1), whether it is fully certified, and, per
//              not-fully-certified category, the unverified contributing
//              features (R12.3); written to
//              `<root>/consumer-platform-certification.report.txt` and echoed to
//              stdout. VERIFIED contributors are annotated with the artifact
//              path that evidences them (R12.4).
//
// Running (after `node dist/verification/capture-evidence.js` has produced
// artifacts under `verification-artifacts/`):
//   node dist/verification/generate-report.js
//   node dist/verification/generate-report.js --out verification-artifacts
//   node dist/verification/generate-report.js --json-only
//
// _Requirements: 1.1, 12.1, 12.2, 12.3, 12.4, 12.5_

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { validateArtifact } from './artifact.js';
import type { VerificationArtifact } from './artifact.js';
import type { ArtifactSource } from './aggregator.js';
import {
  computeCertification,
  REPORT_CATEGORIES,
} from './certification.js';
import type { CertificationReport } from './certification.js';

/** Suffix that marks a file as a recorded Verification Artifact. */
const ARTIFACT_SUFFIX = '.artifact.json';
/** File name the machine-readable Certification Report is persisted under (R12.5). */
export const REPORT_JSON_FILENAME = 'consumer-platform-certification.report.json';
/** File name the human-readable Certification Report is persisted under (R12.1). */
export const REPORT_TEXT_FILENAME = 'consumer-platform-certification.report.txt';

/** Options controlling where artifacts are read from and where the report lands. */
export interface GenerateReportOptions {
  /** Directory the recorded artifacts are read from (default `verification-artifacts`). */
  artifactRoot: string;
  /** Repo root used to resolve a relative `artifactRoot`. */
  repoRoot: string;
  /** Skip writing/echoing the human-readable form when true. */
  jsonOnly?: boolean;
  /** Injected clock for the report timestamp (default `new Date()`). */
  now?: Date;
  /** Optional logger; defaults to `console`. */
  logger?: Pick<Console, 'log' | 'error'>;
}

/** The outcome of a report generation: the report plus where it was written. */
export interface GenerateReportResult {
  /** The `CertificationReport` produced by `computeCertification` (R12.1). */
  report: CertificationReport;
  /** The artifact sources the report was computed from. */
  sources: ArtifactSource[];
  /** Absolute path the JSON report was written to. */
  jsonPath: string;
  /** Absolute path the human-readable report was written to (undefined when `jsonOnly`). */
  textPath?: string;
  /** The rendered human-readable report text. */
  text: string;
}

/**
 * Recursively collect every `*.artifact.json` file under `rootDir`, in a
 * deterministic (sorted) order so the report's `computedFrom` provenance is
 * stable across runs. The report files this script itself writes are never
 * `*.artifact.json`, so they are never treated as inputs.
 */
export function collectArtifactFiles(rootDir: string): string[] {
  const entries = readdirSync(rootDir, { recursive: true, withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(ARTIFACT_SUFFIX)) continue;
    // `parentPath` (Node ≥20.12) / `path` (older) holds the containing dir.
    const dir =
      (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
      (entry as unknown as { path?: string }).path ??
      rootDir;
    files.push(join(dir, entry.name));
  }
  return files.sort();
}

/**
 * Read and validate every recorded Verification Artifact under `rootDir`,
 * pairing each with the path it was read from (for the report's `computedFrom`
 * evidence references, R12.4). Unreadable or schema-invalid files are skipped
 * with a logged reason rather than aborting the report — a missing/invalid
 * artifact simply leaves its capability not VERIFIED (R12.3).
 */
export function loadArtifactSources(
  rootDir: string,
  logger: Pick<Console, 'log' | 'error'> = console,
): ArtifactSource[] {
  const sources: ArtifactSource[] = [];
  for (const filePath of collectArtifactFiles(rootDir)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (err) {
      logger.error(
        `[report]   skipping unreadable artifact ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    const { valid, errors } = validateArtifact(parsed);
    if (!valid) {
      logger.error(`[report]   skipping invalid artifact ${filePath}: ${errors.join('; ')}`);
      continue;
    }
    sources.push({ artifact: parsed as VerificationArtifact, path: filePath });
  }
  return sources;
}

/**
 * Render the human-readable Certification Report scorecard. Lists every one of
 * the eight categories (R12.1) with its fully-certified verdict; for each
 * category it shows each contributing capability with its status, annotating
 * VERIFIED contributors with the artifact path that evidences them (R12.4) and
 * flagging the unverified contributors per not-fully-certified category (R12.3).
 */
export function renderHumanReadable(
  report: CertificationReport,
  sources: ReadonlyArray<ArtifactSource>,
): string {
  // Map each capability to the artifact path that evidences it (R12.4).
  const evidencePath = new Map<string, string>();
  for (const s of sources) {
    if (s.path && typeof s.artifact?.capabilityId === 'string') {
      evidencePath.set(s.artifact.capabilityId, s.path);
    }
  }

  const certifiedCount = report.categories.filter((c) => c.fullyCertified).length;
  const lines: string[] = [];

  lines.push('═'.repeat(72));
  lines.push('  Consumer-Platform Certification Report');
  lines.push('═'.repeat(72));
  lines.push(`  Generated:     ${report.timestamp}`);
  lines.push(`  Categories:    ${certifiedCount}/${report.categories.length} fully certified`);
  lines.push(`  Evidence read: ${report.computedFrom.length} artifact(s)`);
  lines.push('─'.repeat(72));

  for (const cat of report.categories) {
    const verdict = cat.fullyCertified ? '✓ FULLY CERTIFIED' : '✗ NOT FULLY CERTIFIED';
    lines.push('');
    lines.push(`  ${cat.category}: ${verdict}`);
    for (const cap of cat.contributing) {
      const marker = cap.status === 'VERIFIED' ? '✓' : '✗';
      const path = evidencePath.get(cap.capabilityId);
      const evidence = cap.hasArtifact
        ? path
          ? ` — evidence: ${path}`
          : ''
        : ' (no recorded artifact)';
      lines.push(`      ${marker} ${cap.capabilityId.padEnd(28)} ${cap.status}${evidence}`);
    }
    if (!cat.fullyCertified) {
      const unverified = cat.unverified.map((c) => c.capabilityId).join(', ');
      lines.push(`      ↳ unverified features: ${unverified}`);
    }
  }

  lines.push('');
  lines.push('─'.repeat(72));
  lines.push(
    certifiedCount === report.categories.length
      ? '  RESULT: all categories fully certified from recorded evidence.'
      : `  RESULT: ${report.categories.length - certifiedCount} categor` +
        `${report.categories.length - certifiedCount === 1 ? 'y is' : 'ies are'} not fully certified.`,
  );
  lines.push('═'.repeat(72));
  lines.push('');

  return lines.join('\n');
}

/** Write a file atomically: write to a unique temp file then rename into place. */
function writeAtomic(targetPath: string, data: string): void {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    writeFileSync(tmpPath, data, { encoding: 'utf8', flag: 'wx' });
    renameSync(tmpPath, targetPath);
  } catch (err) {
    // Best-effort cleanup; never mask the original error.
    try {
      if (existsSync(tmpPath)) renameSync(tmpPath, `${tmpPath}.orphan`);
    } catch {
      /* ignore cleanup failure */
    }
    throw err;
  }
}

/**
 * Generate the Consumer-Platform Certification Report from recorded artifacts.
 *
 * Reads + validates every `<capabilityId>.artifact.json` under the artifact
 * root, calls the pure `computeCertification` aggregator (the single place the
 * eight-category scorecard is derived, R12.2/R12.5), and writes the report in
 * JSON (verbatim) and human-readable forms. Returns the report and the paths it
 * was written to.
 */
export function generateReport(opts: GenerateReportOptions): GenerateReportResult {
  const logger = opts.logger ?? console;
  const rootDir = isAbsolute(opts.artifactRoot)
    ? opts.artifactRoot
    : resolve(opts.repoRoot, opts.artifactRoot);

  if (!existsSync(rootDir)) {
    throw new Error(
      `Certification Report: artifact directory not found: ${rootDir}. ` +
        `Run capture-evidence first to produce <capabilityId>.artifact.json files.`,
    );
  }

  const sources = loadArtifactSources(rootDir, logger);

  // The aggregator is the ONLY thing that derives the scorecard (R12.2/R12.5).
  const report = computeCertification(sources, opts.now ?? new Date());

  // Persist the machine-readable report verbatim at the artifact root (R12.5).
  const jsonPath = join(rootDir, REPORT_JSON_FILENAME);
  writeAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const text = renderHumanReadable(report, sources);
  let textPath: string | undefined;
  if (!opts.jsonOnly) {
    textPath = join(rootDir, REPORT_TEXT_FILENAME);
    writeAtomic(textPath, text);
  }

  return { report, sources, jsonPath, text, ...(textPath ? { textPath } : {}) };
}

/** Parse the `--out` / `--repo` / `--json-only` argv. */
function parseArgs(argv: readonly string[]): {
  artifactRoot?: string;
  repoRoot?: string;
  jsonOnly: boolean;
} {
  const out: { artifactRoot?: string; repoRoot?: string; jsonOnly: boolean } = {
    jsonOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json-only') out.jsonOnly = true;
    else if (arg === '--out') out.artifactRoot = argv[++i];
    else if (arg === '--repo') out.repoRoot = argv[++i];
  }
  return out;
}

/**
 * Locate the monorepo root by walking up from a starting directory until a
 * `packages/` directory is found beside the current dir. Falls back to two
 * levels up from the compiled `dist/verification/` location.
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'packages')) && existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // dist/verification/ → core → packages → repo root.
  return resolve(startDir, '..', '..', '..', '..');
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2));

  const repoRoot = args.repoRoot ? resolve(args.repoRoot) : findRepoRoot(scriptDir);
  const artifactRoot = args.artifactRoot ?? 'verification-artifacts';

  console.log('\n🔒 Street Framework — Consumer-Platform Certification Report');
  console.log(`   repo:      ${repoRoot}`);
  console.log(`   artifacts: ${isAbsolute(artifactRoot) ? artifactRoot : join(repoRoot, artifactRoot)}`);
  console.log('─'.repeat(72));

  const { report, jsonPath, textPath, text } = generateReport({
    artifactRoot,
    repoRoot,
    jsonOnly: args.jsonOnly,
  });

  if (!args.jsonOnly) {
    // Echo the human-readable scorecard.
    process.stdout.write(`\n${text}\n`);
  }

  console.log(`[report] JSON written to: ${jsonPath}`);
  if (textPath) console.log(`[report] Text written to: ${textPath}`);

  // Mirror — but never set — the aggregate verdict in the exit code so a CI
  // gate fails when any category is not fully certified.
  const allCertified = report.categories.every((c) => c.fullyCertified);
  process.exitCode = allCertified ? 0 : 1;
}

// Run as a script when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
