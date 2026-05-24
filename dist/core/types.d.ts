export type Constructor<T = object> = new (...args: any[]) => T;
export type Awaitable<T> = T | Promise<T>;
/** Immutable readonly deep type */
export type DeepReadonly<T> = T extends (infer U)[] ? ReadonlyArray<DeepReadonly<U>> : T extends object ? {
    readonly [P in keyof T]: DeepReadonly<T[P]>;
} : T;
/** Extracts non-function keys from a type */
export type DataKeys<T> = {
    [K in keyof T]: T[K] extends Function ? never : K;
}[keyof T];
/** Partial data shape (no methods) */
export type DataShape<T> = Pick<T, DataKeys<T>>;
/** Validated result discriminated union */
export type ValidationResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    errors: string[];
};
/** Token pair for auth flows */
export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}
/** Pagination parameters */
export interface PaginationParams {
    page: number;
    limit: number;
    offset: number;
}
/** Generic paginated response */
export interface PaginatedResult<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
}
/** Health status */
export interface HealthStatus {
    status: 'ok' | 'degraded' | 'down';
    uptime: number;
    timestamp: string;
    checks: Record<string, {
        status: 'ok' | 'fail';
        latencyMs?: number;
        detail?: string;
    }>;
}
/** Route metadata stored via decorators */
export interface RouteMetadata {
    method: string;
    path: string;
    handlerName: string;
    middlewares: MiddlewareFn[];
    validate?: ValidationSchema;
    openapi?: OpenApiOperation;
}
/** Controller metadata */
export interface ControllerMetadata {
    prefix: string;
    middlewares: MiddlewareFn[];
}
/** Middleware function signature */
export type MiddlewareFn = (ctx: import('./context.js').StreetContext, next: () => Promise<void>) => Promise<void>;
/** Validation schema (runtime shape validator) */
export interface ValidationSchema {
    body?: Record<string, FieldRule>;
    query?: Record<string, FieldRule>;
    params?: Record<string, FieldRule>;
}
/** Single field validation rule */
export interface FieldRule {
    type: 'string' | 'number' | 'boolean' | 'email' | 'uuid';
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: RegExp;
}
/** OpenAPI operation metadata */
export interface OpenApiOperation {
    summary?: string;
    description?: string;
    tags?: string[];
    responses?: Record<string, {
        description: string;
        schema?: unknown;
    }>;
}
/** IPC message types for cluster workers */
export interface IpcMessage {
    type: 'heartbeat' | 'ready' | 'shutdown' | 'telemetry';
    workerId?: number;
    payload?: unknown;
    ts: number;
}
/** Telemetry sample */
export interface TelemetrySample {
    ts: number;
    heapUsedMb: number;
    rss: number;
    latencyP50: number;
    latencyP99: number;
    requestCount: number;
    errorCount: number;
}
//# sourceMappingURL=types.d.ts.map