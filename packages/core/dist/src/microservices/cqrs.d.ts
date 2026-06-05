export declare class CommandBus {
    private readonly _handlers;
    /**
     * Register a handler for a specific command type.
     * @param commandType  The command class constructor.
     * @param handler      Async function that handles the command.
     */
    register<T>(commandType: new (...args: unknown[]) => T, handler: (cmd: T) => Promise<void>): void;
    /**
     * Dispatch a command to its registered handler.
     * Throws if no handler is registered for the command's constructor.
     */
    dispatch<T>(command: T): Promise<void>;
}
export declare class QueryBus {
    private readonly _handlers;
    /**
     * Register a handler for a specific query type.
     * @param queryType  The query class constructor.
     * @param handler    Async function that handles the query and returns a result.
     */
    register<T, R>(queryType: new (...args: unknown[]) => T, handler: (query: T) => Promise<R>): void;
    /**
     * Dispatch a query to its registered handler and return the result.
     * Throws if no handler is registered for the query's constructor.
     */
    dispatch<T, R>(query: T): Promise<R>;
}
//# sourceMappingURL=cqrs.d.ts.map