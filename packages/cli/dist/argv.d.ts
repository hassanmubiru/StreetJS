export interface ParsedArgs {
    command: string | null;
    positional: string[];
    flags: Record<string, string | boolean>;
}
/**
 * Parse process.argv-like arrays into structured command, positional args, and flags.
 *
 * Supports:
 *   --flag=value
 *   --flag value
 *   --flag         (boolean)
 *   -f value
 *   -f             (boolean)
 *   command sub positional
 */
export declare function argvParser(argv: string[]): ParsedArgs;
//# sourceMappingURL=argv.d.ts.map