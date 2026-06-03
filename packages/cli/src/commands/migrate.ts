// packages/cli/src/commands/migrate.ts
// `street migrate:create <name>`, `street migrate:run`, and `street migrate:diff`

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { CliContext } from '../index.js';

export class MigrateCommand {
  /**
   * `street migrate:create <name>` — creates a new timestamped SQL migration file pair.
   */
  async executeCreate(ctx: CliContext): Promise<void> {
    const name = ctx.args.positional[0];

    if (!name) {
      console.error('[street] Usage: street migrate:create <migration-name>');
      console.error('  Example: street migrate:create create_users_table');
      process.exitCode = 1;
      return;
    }

    const migrationsDir = resolve(ctx.cwd, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const timestamp = this.generateTimestamp();
    const baseName = `${timestamp}_${name}`;

    // Up migration
    const upPath = join(migrationsDir, `${baseName}.sql`);
    const upContent = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}
-- Description: 

-- Write your SQL migration here.
-- Example:
--   CREATE TABLE ${this.toSnakeCase(name)} (
--     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   );

`;

    // Down (rollback) migration
    const downPath = join(migrationsDir, `${baseName}.rollback.sql`);
    const downContent = `-- Rollback: ${name}
-- Created: ${new Date().toISOString()}
-- Description: Rollback ${name}

-- Write your rollback SQL here.
-- Example:
--   DROP TABLE IF EXISTS ${this.toSnakeCase(name)};

`;

    await writeFile(upPath, upContent, 'utf8');
    await writeFile(downPath, downContent, 'utf8');

    console.log(`[street] Created migration: ${baseName}.sql`);
    console.log(`[street] Created rollback:  ${baseName}.rollback.sql`);
  }

  /**
   * `street migrate:run` — runs all pending migrations using Street's migration runner.
   */
  async executeRun(ctx: CliContext): Promise<void> {
    const migrationsDir = resolve(ctx.cwd, 'migrations');
    const mainEntry = resolve(ctx.cwd, 'dist', 'main.js');

    // Check if dist/main.js exists (must build first)
    try {
      await import('node:fs/promises').then((fs) => fs.stat(mainEntry));
    } catch {
      console.error('[street] Build not found. Run "street build" before migrating.');
      process.exitCode = 1;
      return;
    }

    // Discover migration files
    await mkdir(migrationsDir, { recursive: true });
    let files: string[];
    try {
      files = await readdir(migrationsDir);
    } catch {
      console.log('[street] No migrations directory found.');
      return;
    }

    const migrationFiles = files
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.rollback.sql'))
      .sort();

    if (migrationFiles.length === 0) {
      console.log('[street] No migration files found.');
      return;
    }

    console.log(`[street] Found ${migrationFiles.length} migration file(s).`);

    // We need to run migrations via the application's PgPool.
    // Since the application has its own bootstrap, we create a minimal runner here.
    const { PgPool, StreetMigrationRunner } = await import('@streetjs/core');

    const pool = new PgPool({
      host: process.env['PG_HOST'] ?? 'localhost',
      port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
      user: process.env['PG_USER'] ?? 'postgres',
      password: process.env['PG_PASSWORD'] ?? '',
      database: process.env['PG_DATABASE'] ?? 'street',
      minConnections: 1,
      maxConnections: 2,
      idleTimeoutMs: 10_000,
      acquireTimeoutMs: 5_000,
    });

    try {
      await pool.initialize();
      const runner = new StreetMigrationRunner(pool);
      await runner.run(migrationsDir);
    } finally {
      await pool.close();
    }
  }

  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[-\s]+/g, '_')
      .toLowerCase();
  }
}
