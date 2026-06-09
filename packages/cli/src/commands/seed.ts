// packages/cli/src/commands/seed.ts
// `street db:seed <file>` — run a SQL seed file against the configured database.

import { resolve } from 'node:path';
import type { CliContext } from '../index.js';

export class SeedCommand {
  /**
   * `street db:seed <file>`
   *
   * Runs the given seed file via StreetSeeder.  If the file has already been
   * applied (same SHA-256 hash recorded in street_seed_runs) it is skipped.
   */
  async execute(ctx: CliContext): Promise<void> {
    const seedFileArg = ctx.args.positional[0];

    if (!seedFileArg) {
      console.error('[street] Usage: street db:seed <file>');
      console.error('  Example: street db:seed seeds/users.sql');
      process.exitCode = 1;
      return;
    }

    const seedFile = resolve(ctx.cwd, seedFileArg);

    const { PgPool, StreetSeeder } = await import('streetjs');

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
      const result = await StreetSeeder.run(pool, seedFile);

      if (result.skipped) {
        console.log(`[street] Seed already applied (hash: ${result.hash.slice(0, 12)}…), skipping: ${seedFileArg}`);
      } else {
        console.log(`[street] Seed applied (hash: ${result.hash.slice(0, 12)}…): ${seedFileArg}`);
      }
    } finally {
      await pool.close();
    }
  }
}
