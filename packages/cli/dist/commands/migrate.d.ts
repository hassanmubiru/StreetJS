import type { CliContext } from '../index.js';
export declare class MigrateCommand {
    /**
     * `street migrate:create <name>` — creates a new timestamped SQL migration file pair.
     */
    executeCreate(ctx: CliContext): Promise<void>;
    /**
     * `street migrate:run` — runs all pending migrations using Street's migration runner.
     */
    executeRun(ctx: CliContext): Promise<void>;
    private generateTimestamp;
    private toSnakeCase;
    /**
     * `street migrate:diff [--confirm-destructive]`
     *
     * Compares the live database schema against entity decorator metadata and
     * writes the generated SQL to a timestamped file.  Destructive statements
     * (DROP COLUMN) are only written when `--confirm-destructive` is passed.
     */
    executeDiff(ctx: CliContext): Promise<void>;
}
/**
 * Build the SQL file body for a schema diff and decide whether a file should
 * be written at all.
 *
 * Returns `null` when there is nothing worth writing: no safe (additive)
 * statements and destructive statements were not confirmed. Otherwise returns
 * the full file contents. Destructive statements are only included when
 * `confirmDestructive` is true.
 */
export declare function buildDiffSql(diff: {
    safe: string[];
    destructive: string[];
}, confirmDestructive: boolean, generatedAt?: string): string | null;
//# sourceMappingURL=migrate.d.ts.map