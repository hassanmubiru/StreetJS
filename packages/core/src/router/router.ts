// src/router/router.ts
// Compiled regex router with parameter extraction and middleware pipeline.

import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn, ValidationSchema, FieldRule } from '../core/types.js';
import { BadRequestException, NotFoundException, isStreetException } from '../http/exceptions.js';

interface CompiledRoute {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  middlewares: MiddlewareFn[];
  handler: (ctx: StreetContext) => Promise<void> | void;
  validate?: ValidationSchema;
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  /** Compile and register a route */
  add(
    method: string,
    path: string,
    middlewares: MiddlewareFn[],
    handler: (ctx: StreetContext) => Promise<void> | void,
    validate?: ValidationSchema
  ): void {
    const { pattern, paramNames } = compilePath(path);
    this.routes.push({ method: method.toUpperCase(), pattern, paramNames, middlewares, handler, validate });
  }

  /** Match a request and execute the middleware pipeline */
  async dispatch(ctx: StreetContext): Promise<boolean> {
    const matched = this.match(ctx.method, ctx.path);
    if (!matched) return false;

    const { route, params } = matched;
    ctx.params = params;

    // Build pipeline: route middlewares + validation + handler
    const pipeline: MiddlewareFn[] = [
      ...route.middlewares,
      ...(route.validate ? [createValidationMiddleware(route.validate)] : []),
      async (c: StreetContext) => {
        await route.handler(c);
      },
    ];

    await runPipeline(ctx, pipeline, 0);
    return true;
  }

  private match(
    method: string,
    path: string
  ): { route: CompiledRoute; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method && route.method !== '*') continue;
      const m = route.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1] ?? '');
      });
      return { route, params };
    }
    return null;
  }

  /** List all registered routes (for OpenAPI) */
  listRoutes(): Array<{ method: string; path: string }> {
    return this.routes.map((r) => ({ method: r.method, path: r.pattern.source }));
  }
}

/** Convert path string like /users/:id/posts to regex + param names */
function compilePath(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const regexStr = path
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_: string, name: string) => {
      paramNames.push(name);
      return '([^/]+)';
    })
    .replace(/\\\*/g, '(.*)');

  return {
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

/** Execute middleware pipeline recursively */
async function runPipeline(
  ctx: StreetContext,
  pipeline: MiddlewareFn[],
  index: number
): Promise<void> {
  if (index >= pipeline.length) return;
  const mw = pipeline[index];
  if (!mw) return;
  await mw(ctx, () => runPipeline(ctx, pipeline, index + 1));
}

/** Validation middleware factory */
function createValidationMiddleware(schema: ValidationSchema): MiddlewareFn {
  return async (ctx: StreetContext, next: () => Promise<void>) => {
    const errors: string[] = [];

    if (schema.body && ctx.body !== null && typeof ctx.body === 'object') {
      validateObject(schema.body, ctx.body as Record<string, unknown>, 'body', errors);
    }
    if (schema.query) {
      validateObject(schema.query, ctx.query, 'query', errors);
    }
    if (schema.params) {
      validateObject(schema.params, ctx.params, 'params', errors);
    }

    if (errors.length > 0) {
      throw new BadRequestException('Validation failed', errors);
    }

    await next();
  };
}

function validateObject(
  rules: Record<string, FieldRule>,
  data: Record<string, unknown>,
  location: string,
  errors: string[]
): void {
  for (const [field, rule] of Object.entries(rules)) {
    const value = data[field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${location}.${field} is required`);
      continue;
    }
    if (value === undefined || value === null) continue;

    const str = String(value);
    switch (rule.type) {
      case 'string':
        if (typeof value !== 'string') errors.push(`${location}.${field} must be a string`);
        if (rule.min !== undefined && str.length < rule.min)
          errors.push(`${location}.${field} must be at least ${rule.min} chars`);
        if (rule.max !== undefined && str.length > rule.max)
          errors.push(`${location}.${field} must be at most ${rule.max} chars`);
        if (rule.pattern && !rule.pattern.test(str))
          errors.push(`${location}.${field} has invalid format`);
        break;
      case 'number':
        if (isNaN(Number(value))) errors.push(`${location}.${field} must be a number`);
        break;
      case 'boolean':
        if (value !== 'true' && value !== 'false' && typeof value !== 'boolean')
          errors.push(`${location}.${field} must be a boolean`);
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str))
          errors.push(`${location}.${field} must be a valid email`);
        break;
      case 'uuid':
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str))
          errors.push(`${location}.${field} must be a valid UUID`);
        break;
    }
  }
}

/** Not-found handler */
export async function notFoundHandler(ctx: StreetContext): Promise<void> {
  throw new NotFoundException(`Route ${ctx.method} ${ctx.path} not found`);
}

/** Global error handler */
export async function errorHandler(ctx: StreetContext, err: unknown): Promise<void> {
  if (isStreetException(err)) {
    ctx.json(err.toJSON(), err.status);
  } else {
    // Log the full error server-side, but never leak internal details to client
    console.error('[street] Unhandled error:', err);
    ctx.json({ error: 'InternalException', message: 'Internal Server Error', status: 500 }, 500);
  }
}
