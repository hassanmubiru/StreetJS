export declare class CronParseError extends Error {
    constructor(expression: string, reason: string);
}
export declare class CronScheduler {
    private readonly jobs;
    private started;
    /**
     * Register a cron job.
     * Throws `CronParseError` immediately if the expression is invalid.
     */
    register(expression: string, name: string, fn: () => Promise<void>): void;
    /** Start all registered cron jobs by scheduling the first timeout. */
    start(): void;
    /** Stop all cron job timers. */
    stop(): void;
    private _schedule;
    private _fire;
}
//# sourceMappingURL=scheduler.d.ts.map