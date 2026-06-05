import type { MiddlewareFn } from '../core/types.js';
import type { ServiceDefinition } from './schema.js';
export type { ServiceDefinition };
export interface GraphQlEngineOptions {
    schema: ServiceDefinition;
    resolvers: Record<string, Record<string, (parent: unknown, args: unknown, ctx: unknown) => unknown>>;
    maxDepth?: number;
    maxComplexity?: number;
    introspection?: boolean;
}
export interface ExecutionResult {
    data?: unknown;
    errors?: Array<{
        message: string;
    }>;
}
export declare class GraphQlEngine {
    private readonly opts;
    constructor(opts: GraphQlEngineOptions);
    execute(query: string, variables?: Record<string, unknown>, ctx?: unknown): Promise<ExecutionResult>;
}
/**
 * Create a Street middleware that handles POST requests as GraphQL operations.
 * Reads body (already parsed by streetApp), calls engine.execute(), returns JSON.
 */
export declare function graphqlMiddleware(engine: GraphQlEngine): MiddlewareFn;
//# sourceMappingURL=engine.d.ts.map