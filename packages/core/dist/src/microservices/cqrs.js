// src/microservices/cqrs.ts
// Command Bus and Query Bus with typed handler lookup by constructor identity.
export class CommandBus {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _handlers = new Map();
    /**
     * Register a handler for a specific command type.
     * @param commandType  The command class constructor.
     * @param handler      Async function that handles the command.
     */
    register(commandType, handler) {
        if (this._handlers.has(commandType)) {
            throw new Error(`CommandBus: handler already registered for ${commandType.name}`);
        }
        this._handlers.set(commandType, handler);
    }
    /**
     * Dispatch a command to its registered handler.
     * Throws if no handler is registered for the command's constructor.
     */
    async dispatch(command) {
        const ctor = command.constructor;
        const handler = this._handlers.get(ctor);
        if (!handler) {
            throw new Error(`CommandBus: no handler registered for ${ctor.name}`);
        }
        await handler(command);
    }
}
export class QueryBus {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _handlers = new Map();
    /**
     * Register a handler for a specific query type.
     * @param queryType  The query class constructor.
     * @param handler    Async function that handles the query and returns a result.
     */
    register(queryType, handler) {
        if (this._handlers.has(queryType)) {
            throw new Error(`QueryBus: handler already registered for ${queryType.name}`);
        }
        this._handlers.set(queryType, handler);
    }
    /**
     * Dispatch a query to its registered handler and return the result.
     * Throws if no handler is registered for the query's constructor.
     */
    async dispatch(query) {
        const ctor = query.constructor;
        const handler = this._handlers.get(ctor);
        if (!handler) {
            throw new Error(`QueryBus: no handler registered for ${ctor.name}`);
        }
        return handler(query);
    }
}
//# sourceMappingURL=cqrs.js.map