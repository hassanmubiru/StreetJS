import type { CliContext } from '../index.js';
export declare class GenerateCommand {
    execute(ctx: CliContext): Promise<void>;
    private generate;
    private generateController;
    private generateService;
    private generateRepository;
    private toPascalCase;
    private toKebabCase;
    private toSnakeCase;
    private toPlural;
}
/**
 * Generate a typed StreetMiddleware scaffold.
 *
 * Output: `<cwd>/src/middleware/<name>.middleware.ts`
 */
export declare function generateMiddleware(name: string, cwd: string): Promise<void>;
/**
 * Generate a typed WebSocket gateway scaffold.
 * Full implementation in task 2.3.
 *
 * Output: `<cwd>/src/gateways/<name>.gateway.ts`
 */
export declare function generateGateway(name: string, cwd: string): Promise<void>;
/**
 * Generate a timestamped SQL migration pair (up + rollback).
 * Full implementation in task 2.4.
 *
 * Output: `<cwd>/migrations/<timestamp>_<name>.sql` + `.rollback.sql`
 */
export declare function generateMigration(name: string, cwd: string): Promise<void>;
//# sourceMappingURL=generate.d.ts.map