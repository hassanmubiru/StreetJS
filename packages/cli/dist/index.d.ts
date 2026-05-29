import type { ParsedArgs } from './argv.js';
export interface CliContext {
    cwd: string;
    args: ParsedArgs;
}
/**
 * Main CLI entry point. Parses process.argv, finds a matching command,
 * executes it, and handles errors.
 */
export declare function runCli(argv: string[]): Promise<void>;
//# sourceMappingURL=index.d.ts.map