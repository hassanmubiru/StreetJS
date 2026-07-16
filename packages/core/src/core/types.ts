// src/core/types.ts
// Shared type utilities used across the framework.

/**
 * A newable class reference. The canonical definition now lives in the
 * standalone @streetjs/container package (single source of truth); re-exported
 * here so existing `../core/types.js` importers keep working — dependency inversion.
 */
export type { Constructor } from '@streetjs/container';

export type Awaitable<T> = T | Promise<T>;

/** Token pair for auth flows */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Generic paginated response */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
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

/**
 * Middleware function signature. The canonical definition now lives in the
 * standalone @streetjs/context package (single source of truth, since it is a
 * function of StreetContext); re-exported here so existing `../core/types.js`
 * importers keep working — dependency inversion.
 */
export type { MiddlewareFn } from '@streetjs/context';

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
  responses?: Record<string, { description: string; schema?: unknown }>;
}

/**
 * IPC message types for cluster workers. The canonical definition now lives in
 * the standalone @streetjs/cluster package (single source of truth); re-exported
 * here so existing `../core/types.js` importers keep working — dependency inversion.
 */
export type { IpcMessage } from '@streetjs/cluster';

/**
 * Telemetry sample. The canonical definition now lives in the standalone
 * @streetjs/telemetry package (single source of truth); re-exported here so
 * existing `../core/types.js` importers keep working — dependency inversion.
 */
export type { TelemetrySample } from '@streetjs/telemetry';
