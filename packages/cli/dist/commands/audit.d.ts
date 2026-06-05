import type { CliContext } from '../index.js';
export declare class AuditCommand {
    execute(ctx: CliContext): Promise<void>;
    private isFindings;
    private printSummary;
    private countBySeverity;
    private printTable;
    private describeFix;
    protected runNpmAudit(cwd: string): Promise<string>;
}
//# sourceMappingURL=audit.d.ts.map