// packages/cli/src/commands/diagnostics.ts
// `street diagnostics [--pid <pid>]` — live terminal dashboard reading from
// a running process's Unix diagnostics socket.

import { createConnection } from 'node:net';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CliContext } from '../index.js';

interface RouteStats {
  count: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

interface DiagnosticsSnapshot {
  ts: string;
  routes: Record<string, RouteStats>;
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
}

const CLEAR = '\x1b[2J\x1b[H';
const BOLD  = '\x1b[1m';
const RESET = '\x1b[0m';
const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function renderTable(snapshot: DiagnosticsSnapshot): string {
  const lines: string[] = [];

  lines.push(`${BOLD}${CYAN}Street Diagnostics Dashboard${RESET}  ${snapshot.ts}`);
  lines.push('');

  // Memory
  const { heapUsed, heapTotal, rss } = snapshot.memory;
  lines.push(`${BOLD}Memory${RESET}  heap ${mb(heapUsed)} / ${mb(heapTotal)}  rss ${mb(rss)}`);
  lines.push('');

  // Routes table
  const routes = Object.entries(snapshot.routes);
  if (routes.length === 0) {
    lines.push('(no route traffic recorded yet)');
  } else {
    const COL = [32, 8, 10, 10, 10, 10];
    const header = [
      'Route'.padEnd(COL[0]!),
      'Reqs'.padStart(COL[1]!),
      'ErrRate'.padStart(COL[2]!),
      'P50 ms'.padStart(COL[3]!),
      'P95 ms'.padStart(COL[4]!),
      'P99 ms'.padStart(COL[5]!),
    ].join('  ');
    lines.push(BOLD + header + RESET);
    lines.push('-'.repeat(header.length));

    for (const [route, stats] of routes) {
      const errPct = (stats.errorRate * 100).toFixed(1) + '%';
      const errColour = stats.errorRate > 0.05 ? YELLOW : GREEN;
      const row = [
        route.slice(0, COL[0]!).padEnd(COL[0]!),
        String(stats.count).padStart(COL[1]!),
        (errColour + errPct + RESET).padStart(COL[2]! + errColour.length + RESET.length),
        stats.p50Ms.toFixed(2).padStart(COL[3]!),
        stats.p95Ms.toFixed(2).padStart(COL[4]!),
        stats.p99Ms.toFixed(2).padStart(COL[5]!),
      ].join('  ');
      lines.push(row);
    }
  }

  lines.push('');
  lines.push('Press Ctrl+C to exit.');
  return lines.join('\n');
}

export class DiagnosticsCommand {
  async execute(ctx: CliContext): Promise<void> {
    const pidArg = ctx.args.flags['pid'];
    const pid = typeof pidArg === 'string'
      ? parseInt(pidArg, 10)
      : typeof pidArg === 'number'
        ? pidArg
        : process.pid;

    const socketPath = `/tmp/street-${pid}.sock`;

    // Stale socket detection
    let processAlive = true;
    try {
      process.kill(pid, 0);
    } catch {
      processAlive = false;
    }

    if (!processAlive) {
      console.warn(`[street] Process ${pid} is not running. Socket may be stale.`);
      try {
        await unlink(socketPath);
        console.warn(`[street] Removed stale socket: ${socketPath}`);
      } catch {
        // File may not exist
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
        // Process complete JSON lines
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const snapshot = JSON.parse(line) as DiagnosticsSnapshot;
            process.stdout.write(CLEAR + renderTable(snapshot) + '\n');
          } catch {
            // Ignore malformed JSON
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

      void resolve; // suppress unused warning
    });
  }
}
