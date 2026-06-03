// src/router/router.ts
// Compiled regex router with parameter extraction and middleware pipeline.
import { BadRequestException, NotFoundException, isStreetException } from '../http/exceptions.js';
import { diagnosticsReporter } from '../diagnostics/reporter.js';
export class Router {
    routes = [];
    /** Compile and register a route */
    add(method, path, middlewares, handler, validate) {
        const { pattern, paramNames } = compilePath(path);
        this.routes.push({ method: method.toUpperCase(), pattern, paramNames, middlewares, handler, validate });
    }
    /** Match a request and execute the middleware pipeline */
    async dispatch(ctx) {
        const matched = this.match(ctx.method, ctx.path);
        if (!matched)
            return false;
        const { route, params } = matched;
        ctx.params = params;
        // Build pipeline: route middlewares + validation + handler
        const pipeline = [
            ...route.middlewares,
            ...(route.validate ? [createValidationMiddleware(route.validate)] : []),
            async (c) => {
                await route.handler(c);
            },
        ];
        await runPipeline(ctx, pipeline, 0);
        return true;
    }
    match(method, path) {
        for (const route of this.routes) {
            if (route.method !== method && route.method !== '*')
                continue;
            const m = route.pattern.exec(path);
            if (!m)
                continue;
            const params = {};
            route.paramNames.forEach((name, i) => {
                params[name] = decodeURIComponent(m[i + 1] ?? '');
            });
            return { route, params };
        }
        return null;
    }
    /** List all registered routes (for OpenAPI) */
    listRoutes() {
        return this.routes.map((r) => ({ method: r.method, path: r.pattern.source }));
    }
}
/** Convert path string like /users/:id/posts to regex + param names */
function compilePath(path) {
    const paramNames = [];
    const regexStr = path
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
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
async function runPipeline(ctx, pipeline, index) {
    if (index >= pipeline.length)
        return;
    const mw = pipeline[index];
    if (!mw)
        return;
    await mw(ctx, () => runPipeline(ctx, pipeline, index + 1));
}
/** Validation middleware factory */
function createValidationMiddleware(schema) {
    return async (ctx, next) => {
        const errors = [];
        if (schema.body && ctx.body !== null && typeof ctx.body === 'object') {
            validateObject(schema.body, ctx.body, 'body', errors);
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
function validateObject(rules, data, location, errors) {
    for (const [field, rule] of Object.entries(rules)) {
        const value = data[field];
        if (rule.required && (value === undefined || value === null || value === '')) {
            errors.push(`${location}.${field} is required`);
            continue;
        }
        if (value === undefined || value === null)
            continue;
        const str = String(value);
        switch (rule.type) {
            case 'string':
                if (typeof value !== 'string')
                    errors.push(`${location}.${field} must be a string`);
                if (rule.min !== undefined && str.length < rule.min)
                    errors.push(`${location}.${field} must be at least ${rule.min} chars`);
                if (rule.max !== undefined && str.length > rule.max)
                    errors.push(`${location}.${field} must be at most ${rule.max} chars`);
                if (rule.pattern && !rule.pattern.test(str))
                    errors.push(`${location}.${field} has invalid format`);
                break;
            case 'number':
                if (isNaN(Number(value)))
                    errors.push(`${location}.${field} must be a number`);
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
export async function notFoundHandler(ctx) {
    throw new NotFoundException(`Route ${ctx.method} ${ctx.path} not found`);
}
/** Global error handler */
export async function errorHandler(ctx, err) {
    if (isStreetException(err)) {
        ctx.json(err.toJSON(), err.status);
    }
    else {
        // Log the full error server-side, but never leak internal details to client
        const correlationId = typeof ctx.state?.['correlationId'] === 'string'
            ? ctx.state['correlationId']
            : undefined;
        diagnosticsReporter.report(err, correlationId);
        ctx.json({ error: 'InternalException', message: 'Internal Server Error', status: 500 }, 500);
    }
}
//# sourceMappingURL=router.js.map