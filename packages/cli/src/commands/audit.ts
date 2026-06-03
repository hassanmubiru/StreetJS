// packages/cli/src/commands/audit.ts
// `street audit` — runs npm audit and formats CVE findings as a table.

import { spawn } from 'node:child_process';
import type { CliContext } from '../index.js';

interface Vulnerability {
  name: string;
  severity: string;
  via: string[];
  fixAvailable: boolean | { name: string; version: string };
}

interface NpmAuditOutput {
  vulnerabilities?: Record<string, {
    name: string;
    severity: string;
    via: Array<string | { source: number; name: string; dependency: string; title: string; url: string; severity: string }>;
    fixAvailable: boolean | { name: string; version: string };
  }>;
  metadata?: {
    vulnerabilities?: {
      info: number;
      low: number;
      moderate: number;
      high: number;
      critical: number;
      total: number;
    };
  };
}

export class AuditCommand {
  async execute(ctx: CliContext): Promise<void> {
    console.log('[street] Running npm audit...\n');

    let jsonOutput = '';
    let exitCode = 0;

    try {
      jsonOutput = await this.runNpmAudit(ctx.cwd);
    } catch (err) {
      if (typeof err === 'object' && err !== null && 'output' in err) {
        jsonOutput = (err as { output: string }).output;
        exitCode = (err as unknown as { code: number }).code;
      } else {
        console.error('[street] Failed to run npm audit:', (err as Error).message);
        process.exitCode = 1;
        return;
      }
    }

    let audit: NpmAuditOutput;
    try {
      audit = JSON.parse(jsonOutput) as NpmAuditOutput;
    } catch {
      console.error('[street] Failed to parse npm audit output');
      process.exitCode = 1;
      return;
    }

    const vulns = audit.vulnerabilities ?? {};
    const meta = audit.metadata?.vulnerabilities;

    if (Object.keys(vulns).length === 0) {
      console.log('  ✓ No vulnerabilities found\n');
      return;
    }

    // ── Print summary ─────────────────────────────────────────────────────
    if (meta) {
      console.log(`  Summary: ${meta.critical} critical, ${meta.high} high, ${meta.moderate} moderate, ${meta.low} low (${meta.total} total)\n`);
    }

    // ── Print table ───────────────────────────────────────────────────────
    const entries: Vulnerability[] = Object.values(vulns).map((v) => ({
      name: v.name,
      severity: v.severity,
      via: v.via.map((x) => typeof x === 'string' ? x : x.title),
      fixAvailable: v.fixAvailable,
    }));

    // Sort by severity: critical > high > moderate > low > info
    const order: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
    entries.sort((a, b) => (order[a.severity] ?? 5) - (order[b.severity] ?? 5));

    const colWidths = {
      name: Math.max(8, ...entries.map((e) => e.name.length)) + 2,
      severity: 10,
      fix: 20,
    };

    const header = `  ${'Package'.padEnd(colWidths.name)}${'Severity'.padEnd(colWidths.severity)}${'Fix'}`;
    const divider = `  ${'-'.repeat(colWidths.name + colWidths.severity + colWidths.fix)}`;
    console.log(header);
    console.log(divider);

    for (const entry of entries) {
      const severityColors: Record<string, string> = {
        critical: '\x1b[41m\x1b[37m',
        high: '\x1b[31m',
        moderate: '\x1b[33m',
        low: '\x1b[36m',
      };
      const reset = '\x1b[0m';
      const color = severityColors[entry.severity] ?? '';

      const fixText = typeof entry.fixAvailable === 'object'
        ? `upgrade to ${entry.fixAvailable.name}@${entry.fixAvailable.version}`
        : entry.fixAvailable ? 'npm audit fix'
        : 'no fix available';

      console.log(
        `  ${entry.name.padEnd(colWidths.name)}${color}${entry.severity.padEnd(colWidths.severity)}${reset}${fixText}`,
      );
    }
    console.log('');

    if (exitCode !== 0) {
      process.exitCode = 1;
    }
  }

  private runNpmAudit(cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('npm', ['audit', '--json'], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });

      let out = '';
      let err = '';

      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });

      child.on('close', (code) => {
        // npm audit exits with non-zero when vulnerabilities found — that's expected
        if (out) {
          if (code !== 0) {
            reject({ output: out, code: code ?? 1 });
          } else {
            resolve(out);
          }
        } else {
          reject(new Error(err || 'npm audit produced no output'));
        }
      });

      child.on('error', (e) => { reject(e); });
    });
  }
}
