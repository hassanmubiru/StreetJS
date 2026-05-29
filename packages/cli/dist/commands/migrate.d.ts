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
}
//# sourceMappingURL=migrate.d.ts.map