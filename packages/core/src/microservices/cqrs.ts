// src/microservices/cqrs.ts
// Command Bus and Query Bus with typed handler lookup by constructor identity.

// ── CommandBus ────────────────────────────────────────────────────────────────

type CommandHandler<T> = (cmd: T) => Promise<void>;

export class CommandBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _handlers = new Map<new (...args: any[]) => unknown, CommandHandler<unknown>>();

  /**
   * Register a handler for a specific command type.
   * @param commandType  The command class constructor.
   * @param handler      Async function that handles the command.
   */
  register<T>(
    commandType: new (...args: unknown[]) => T,
    handler: (cmd: T) => Promise<void>,
  ): void {
    if (this._handlers.has(commandType)) {
      throw new Error(`CommandBus: handler already registered for ${commandType.name}`);
    }
    this._handlers.set(commandType, handler as CommandHandler<unknown>);
  }

  /**
   * Dispatch a command to its registered handler.
   * Throws if no handler is registered for the command's constructor.
   */
  async dispatch<T>(command: T): Promise<void> {
    const ctor = (command as object).constructor as new (...args: unknown[]) => T;
    const handler = this._handlers.get(ctor) as CommandHandler<T> | undefined;
    if (!handler) {
      throw new Error(`CommandBus: no handler registered for ${ctor.name}`);
    }
    await handler(command);
  }
}

// ── QueryBus ──────────────────────────────────────────────────────────────────

type QueryHandler<T, R> = (query: T) => Promise<R>;

export class QueryBus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly _handlers = new Map<new (...args: any[]) => unknown, QueryHandler<unknown, unknown>>();

  /**
   * Register a handler for a specific query type.
   * @param queryType  The query class constructor.
   * @param handler    Async function that handles the query and returns a result.
   */
  register<T, R>(
    queryType: new (...args: unknown[]) => T,
    handler: (query: T) => Promise<R>,
  ): void {
    if (this._handlers.has(queryType)) {
      throw new Error(`QueryBus: handler already registered for ${queryType.name}`);
    }
    this._handlers.set(queryType, handler as QueryHandler<unknown, unknown>);
  }

  /**
   * Dispatch a query to its registered handler and return the result.
   * Throws if no handler is registered for the query's constructor.
   */
  async dispatch<T, R>(query: T): Promise<R> {
    const ctor = (query as object).constructor as new (...args: unknown[]) => T;
    const handler = this._handlers.get(ctor) as QueryHandler<T, R> | undefined;
    if (!handler) {
      throw new Error(`QueryBus: no handler registered for ${ctor.name}`);
    }
    return handler(query);
  }
}
