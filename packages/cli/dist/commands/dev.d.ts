import type { CliContext } from '../index.js';
export declare class DevCommand {
    private childProcess;
    private abortController;
    execute(ctx: CliContext): Promise<void>;
    private runWithDevWatcher;
    private runLegacy;
    private compile;
    private startServer;
    private killServer;
    private watchSource;
}
//# sourceMappingURL=dev.d.ts.map