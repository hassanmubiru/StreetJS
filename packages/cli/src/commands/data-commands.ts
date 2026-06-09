// packages/cli/src/commands/data-commands.ts
// DB-backed operational commands: analytics report, audit export, compliance
// report, and backup restore. Each builds a PgPool from PG_* env vars.

import { resolve } from 'node:path';
import type { CliContext } from '../index.js';
import type { PgPool } from 'streetjs';

async function makePool(): Promise<PgPool> {
  const core = await import('streetjs');
  const pool = new core.PgPool({
    host: process.env['PG_HOST'] ?? 'localhost',
    port: Number(process.env['PG_PORT'] ?? 5432),
    user: process.env['PG_USER'] ?? 'postgres',
    password: process.env['PG_PASSWORD'] ?? '',
    database: process.env['PG_DATABASE'] ?? 'postgres',
    minConnections: 1,
    maxConnections: 2,
  });
  await pool.initialize();
  return pool;
}

export class AnalyticsReportCommand {
  async execute(ctx: CliContext): Promise<void> {
    const from = new Date(String(ctx.args.flags['from'] ?? new Date(Date.now() - 7 * 86400000).toISOString()));
    const to = new Date(String(ctx.args.flags['to'] ?? new Date().toISOString()));
    const core = await import('streetjs');
    const pool = await makePool();
    try {
      const svc = new core.AnalyticsService({ pool: pool as never });
      const report = await svc.report(from, to);
      console.log(`\n  API Analytics — ${report.from} → ${report.to}\n`);
      console.log('  Route'.padEnd(34) + 'Method'.padEnd(8) + 'Count'.padEnd(8) + 'Avg ms'.padEnd(10) + 'Err%');
      for (const r of report.routes) {
        console.log(`  ${r.route.padEnd(32)}${r.method.padEnd(8)}${String(r.count).padEnd(8)}${String(r.avgLatencyMs).padEnd(10)}${(r.errorRate * 100).toFixed(1)}`);
      }
      console.log('');
      await svc.close();
    } finally {
      await pool.close();
    }
  }
}

export class AuditExportCommand {
  async execute(ctx: CliContext): Promise<void> {
    const from = new Date(String(ctx.args.flags['from'] ?? new Date(0).toISOString()));
    const to = new Date(String(ctx.args.flags['to'] ?? new Date().toISOString()));
    const format = String(ctx.args.flags['format'] ?? 'jsonl') as 'jsonl' | 'csv';
    const core = await import('streetjs');
    const pool = await makePool();
    try {
      const logger = new core.AuditLogger({ pool: pool as never, signingKey: process.env['AUDIT_SIGNING_KEY'] ?? 'change-me-32-bytes-minimum-key!!' });
      const stream = await logger.export(from, to, format);
      await new Promise<void>((res, rej) => {
        stream.on('data', (c: Buffer | string) => process.stdout.write(c));
        stream.on('end', () => res());
        stream.on('error', rej);
      });
    } finally {
      await pool.close();
    }
  }
}

export class ComplianceReportCommand {
  async execute(ctx: CliContext): Promise<void> {
    const entitiesPath = String(ctx.args.flags['entities'] ?? './dist/entities.js');
    const core = await import('streetjs');
    let entities: unknown[];
    try {
      const mod = await import(resolve(ctx.cwd, entitiesPath)) as { entities?: unknown[]; default?: unknown[] };
      entities = mod.entities ?? mod.default ?? [];
    } catch {
      console.error(`[street] Could not load entities from "${entitiesPath}". Pass --entities <path> exporting { entities: [...] }.`);
      process.exitCode = 1;
      return;
    }
    const report = core.ComplianceReporter.report(entities as never);
    console.log('\n  Compliance Report\n');
    console.log('  Field'.padEnd(28) + 'Classification'.padEnd(16) + 'Encrypted'.padEnd(12) + 'Retention');
    for (const r of report) {
      console.log(`  ${String(r.field).padEnd(26)}${String(r.classification ?? '-').padEnd(16)}${String(r.encrypted).padEnd(12)}${r.retentionPeriod ?? '-'}`);
    }
    console.log('');
  }
}

export class RestoreCommand {
  async execute(ctx: CliContext): Promise<void> {
    const backupId = ctx.args.flags['backup-id'];
    if (!backupId || typeof backupId !== 'string') {
      console.error('[street] Usage: street restore --backup-id <id> [--dir <local-backup-dir>]');
      process.exitCode = 1;
      return;
    }
    const dir = String(ctx.args.flags['dir'] ?? './backups');
    const core = await import('streetjs');
    const pool = await makePool();
    try {
      const storage = new core.LocalStorageAdapter(resolve(ctx.cwd, dir));
      const svc = new core.BackupService(pool as never, storage);
      await svc.restore(backupId);
      console.log(`[street] Restore of backup ${backupId} complete.`);
    } catch (err) {
      console.error(`[street] Restore failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    } finally {
      await pool.close();
    }
  }
}
