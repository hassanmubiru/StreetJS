import type { Constructor } from '../core/types.js';
export interface ParsedArgs {
    command: string | null;
    positional: string[];
    flags: Record<string, string | boolean>;
}
/** Parse process.argv into structured args */
export declare function parseArgv(argv: string[]): ParsedArgs;
export interface CliKernelOptions {
    appName?: string;
    version?: string;
}
export declare class CliKernel {
    private readonly handlers;
    private readonly opts;
    constructor(opts?: CliKernelOptions);
    /** Register a class containing @Command-decorated methods */
    register(ctor: Constructor): void;
    /** Run a command from parsed args */
    run(args: ParsedArgs): Promise<void>;
    /** Execute from process.argv */
    execute(): Promise<void>;
    private _printHelp;
}
//# sourceMappingURL=kernel.d.ts.map