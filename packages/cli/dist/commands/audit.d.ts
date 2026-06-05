import type { CliContext } from '../index.js';
interface AuditResult {
    output: string;
    code: number;
}
export declare class AuditCommand {
    execute(ctx: CliContext): Promise<void>;
    private printSummary;
    private countBySeverity;
    private printTable;
    private describeFix;
    protected runNpmAudit(cwd: string): Promise<AuditResult>;
}
export {};
//# sourceMappingURL=audit.d.ts.map