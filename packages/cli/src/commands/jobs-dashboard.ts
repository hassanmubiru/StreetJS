// packages/cli/src/commands/jobs-dashboard.ts
// `street jobs:dashboard [--pid <pid>]` — live terminal dashboard for the job
// queue, reading from a running process's Unix diagnostics socket.
//
// Follows the same conventions as `diagnostics.ts`: connect to /tmp/street-<pid>.sock,
// detect stale sockets, render an ANSI terminal table, and refresh on each
// snapshot the DiagnosticsServer pushes (~every second; well within the 2s target).

import { createConnection } from 'node:net';
import { unlink } from 'node:fs/promises';
import { isStaleSocket } from 'streetjs';
import type { CliContext } from '../index.js';

/**
 * Job-queue metrics as embedded in the DiagnosticsServer snapshot. Mirrors
 * `JobQueueMetrics` from @streetjs/core, with optional forward-compatible
 * fields (`workers`, `dlqDepth`, `history`) the server may add later. When a
 * field is absent the dashboard renders it as "n/a" rather than failing.
 */
interface JobHistoryEntry {
  type: string;
  status: string;
  durationMs?: number;
  finishedAt?: string;
}

interface JobsMetrics {
  pending: number;
  inFlight: number;
  failed: number;
  succeeded: number;
  byType: Record<string, { avgDurationMs: number }>;
  /** Active worker count, if the server reports it. */
  workers?: number;
  /** Dead-letter-queue depth, if the server reports it. */
  dlqDepth?: number;
  /** Recent job history entries (most-recent first), if the server reports them. */
  history?: JobHistoryEntry[];
}

interface JobsSnapshot {
  ts: string;
  jobs: JobsMetrics | null;
}

const CLEAR = '\x1b[2J\x1b[H';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';

/** Cap on the number of history rows displayed, per the spec. */
const MAX_HISTORY_ROWS = 50;

function statusColour(status: string): string {
  switch (status) {
    case 'succeeded': return GREEN;
    case 'failed':    return RED;
    case 'running':   return CYAN;
    default:          return YELLOW;
  }
}

/**
 * Render the jobs dashboard for a single snapshot. Pure function (no I/O) so it
 * can be unit-tested directly.
 */
export function renderJobsTable(snapshot: JobsSnapshot): string {
  const lines: string[] = [];

  lines.push(`${BOLD}${CYAN}Street Jobs Dashboard${RESET}  ${snapshot.ts}`);
  lines.push('');

  const jobs = snapshot.jobs;
  if (!jobs) {
    lines.push('(no job-queue metrics available — is a JobQueue wired into the DiagnosticsServer?)');
    lines.push('');
    lines.push('Press Ctrl+C to exit.');
    return lines.join('\n');
  }

  // ── Summary line: queue depth, workers, DLQ depth ─────────────────────────
  const workers = jobs.workers !== undefined ? String(jobs.workers) : 'n/a';
  const dlqDepth = jobs.dlqDepth !== undefined ? String(jobs.dlqDepth) : 'n/a';
  const dlqColour = jobs.dlqDepth !== undefined && jobs.dlqDepth > 0 ? RED : GREEN;

  lines.push(
    `${BOLD}Queue${RESET}  pending ${YELLOW}${jobs.pending}${RESET}` +
    `  in-flight ${CYAN}${jobs.inFlight}${RESET}` +
    `  workers ${workers}`,
  );
  lines.push(
    `${BOLD}Totals${RESET}  succeeded ${GREEN}${jobs.succeeded}${RESET}` +
    `  failed ${RED}${jobs.failed}${RESET}` +
    `  DLQ depth ${dlqColour}${dlqDepth}${RESET}`,
  );
  lines.push('');

  // ── Per-type stats table ──────────────────────────────────────────────────
  const types = Object.entries(jobs.byType);
  if (types.length === 0) {
    lines.push('(no per-type job stats recorded yet)');
  } else {
    const COL = [32, 16];
    const header = [
      'Job Type'.padEnd(COL[0]!),
      'Avg ms'.padStart(COL[1]!),
    ].join('  ');
    lines.push(BOLD + 'Per-Type Stats' + RESET);
    lines.push(BOLD + header + RESET);
    lines.push('-'.repeat(header.length));
    for (const [type, stats] of types) {
      lines.push([
        type.slice(0, COL[0]!).padEnd(COL[0]!),
        stats.avgDurationMs.toFixed(2).padStart(COL[1]!),
      ].join('  '));
    }
  }
  lines.push('');

  // ── Recent job history (last 50 entries) ──────────────────────────────────
  const history = jobs.history;
  if (history && history.length > 0) {
    const rows = history.slice(0, MAX_HISTORY_ROWS);
    const COL = [28, 12, 12, 26];
    const header = [
      'Type'.padEnd(COL[0]!),
      'Status'.padEnd(COL[1]!),
      'Duration'.padStart(COL[2]!),
      'Finished'.padEnd(COL[3]!),
    ].join('  ');
    lines.push(`${BOLD}Recent History${RESET} (last ${rows.length})`);
    lines.push(BOLD + header + RESET);
    lines.push('-'.repeat(header.length));
    for (const entry of rows) {
      const colour = statusColour(entry.status);
      const duration = entry.durationMs !== undefined ? entry.durationMs.toFixed(0) + 'ms' : '-';
      lines.push([
        entry.type.slice(0, COL[0]!).padEnd(COL[0]!),
        (colour + entry.status + RESET).padEnd(COL[1]! + colour.length + RESET.length),
        duration.padStart(COL[2]!),
        (entry.finishedAt ?? '-').slice(0, COL[3]!).padEnd(COL[3]!),
      ].join('  '));
    }
  } else {
    lines.push('(no job history entries reported)');
  }

  lines.push('');
  lines.push('Refreshing every ~2s. Press Ctrl+C to exit.');
  return lines.join('\n');
}

export class JobsDashboardCommand {
  async execute(ctx: CliContext): Promise<void> {
    const pidArg = ctx.args.flags['pid'] ?? process.env['STREET_PID'];
    const pid = typeof pidArg === 'string'
      ? parseInt(pidArg, 10)
      : typeof pidArg === 'number'
        ? pidArg
        : process.pid;

    if (Number.isNaN(pid)) {
      console.error('[street] Invalid --pid value. Provide a numeric process id.');
      process.exitCode = 1;
      return;
    }

    const socketPath = `/tmp/street-${pid}.sock`;

    // Reuse the shared stale-socket detection helper from @streetjs/core.
    if (await isStaleSocket(socketPath)) {
      console.warn(`[street] Process ${pid} is not running. Socket is stale.`);
      try {
        await unlink(socketPath);
        console.warn(`[street] Removed stale socket: ${socketPath}`);
      } catch {
        // File may have already been removed.
      }
      process.exitCode = 1;
      return;
    }

    console.log(`[street] Connecting to diagnostics socket: ${socketPath}`);

    return new Promise<void>((resolve) => {
      const socket = createConnection(socketPath);
      let buffer = '';

      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        // Process complete newline-delimited JSON snapshots.
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';

        for (const line of parts) {
          if (!line.trim()) continue;
          try {
            const snapshot = JSON.parse(line) as JobsSnapshot;
            process.stdout.write(CLEAR + renderJobsTable(snapshot) + '\n');
          } catch {
            // Ignore malformed JSON lines.
          }
        }
      });

      socket.on('error', (err) => {
        console.error('[street] Diagnostics connection error:', err.message);
        process.exitCode = 1;
        resolve();
      });

      socket.on('close', () => {
        console.log('[street] Diagnostics connection closed.');
        resolve();
      });

      const onSignal = (): void => {
        socket.destroy();
        resolve();
        process.exit(0);
      };

      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
    });
  }
}
