// src/http/server.ts
// Core HTTP server: body parsing, routing, lifecycle hooks, OpenAPI registration.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { Router, notFoundHandler, errorHandler } from '../router/router.js';
import { createContext } from '../core/context.js';
import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn, RouteMetadata, ControllerMetadata } from '../core/types.js';
import { container } from '../core/container.js';
import type { Constructor } from '../core/types.js';
import { getControllerMeta, getRoutesMeta } from '../core/decorators.js';
import { MultipartParser } from '../multipart/parser.js';
import { generateOpenApi } from './openapi.js';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB JSON body limit
const REQUEST_TIMEOUT_MS = 30_000;

export interface StreetAppOptions {
  port?: number;
  host?: string;
  globalMiddlewares?: MiddlewareFn[];
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
  uploadsDir?: string;
}

export interface StreetApp {
  listen(port?: number, host?: string): Promise<void>;
  close(): Promise<void>;
  registerController(ctor: Constructor): void;
  use(mw: MiddlewareFn): void;
  openApiSpec(): object;
}

interface RegisteredRoute {
  method: string;
  fullPath: string;
  meta: RouteMetadata;
  controllerMeta: ControllerMetadata;
}

export function streetApp(options: StreetAppOptions = {}): StreetApp {
  const router = new Router();
  const globalMiddlewares: MiddlewareFn[] = [...(options.globalMiddlewares ?? [])];
  const registeredRoutes: RegisteredRoute[] = [];
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const uploadsDir = options.uploadsDir ?? './uploads';

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // Per-request timeout
    const reqTimeout = setTimeout(() => {
      if (!res.writableEnded) {
        res.writeHead(408, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request Timeout', status: 408 }));
      }
      req.destroy();
    }, requestTimeoutMs);
    reqTimeout.unref();

    res.once('finish', () => clearTimeout(reqTimeout));
    res.once('close', () => clearTimeout(reqTimeout));

    const rawUrl = req.url ?? '/';
    const base = `http://${req.headers.host ?? 'localhost'}`;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl, base);
    } catch {
      res.writeHead(400);
      res.end('Bad Request URI');
      return;
    }

    const path = parsedUrl.pathname;
    const query: Record<string, string> = {};
    parsedUrl.searchParams.forEach((v, k) => {
      query[k] = v;
    });

    const ctx = createContext(req, res, path, query);

    try {
      // Parse body before dispatching
      await parseBody(req, ctx, maxBodyBytes, uploadsDir);

      // Run global middlewares then router
      const pipeline: MiddlewareFn[] = [
        ...globalMiddlewares,
        async (c: StreetContext, next: () => Promise<void>) => {
          const matched = await router.dispatch(c);
          if (!matched) {
            await notFoundHandler(c);
          }
          await next();
        },
      ];

      await runPipeline(ctx, pipeline, 0);
    } catch (err) {
      if (!ctx.sent) {
        await errorHandler(ctx, err);
      }
    }
  });

  async function parseBody(
    req: IncomingMessage,
    ctx: StreetContext,
    maxBytes: number,
    uploadsPath: string
  ): Promise<void> {
    const method = req.method?.toUpperCase() ?? 'GET';
    if (method === 'GET' || method === 'HEAD' || method === 'DELETE') return;

    const contentType = req.headers['content-type'] ?? '';

    if (contentType.includes('multipart/form-data')) {
      const boundary = extractBoundary(contentType);
      if (!boundary) return;
      const parser = new MultipartParser(boundary, uploadsPath, maxBytes);
      const result = await parser.parse(req);
      (ctx as unknown as Record<string, unknown>)['files'] = result.files;
      (ctx as unknown as Record<string, unknown>)['body'] = result.fields;
      return;
    }

    if (contentType.includes('application/json') || contentType.includes('text/')) {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      const onData = (chunk: Buffer): void => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          req.destroy(new Error('Body too large'));
          rejectRef(new Error('Request body exceeds limit'));
          return;
        }
        chunks.push(chunk);
      };
      const onEnd = (): void => resolveRef();
      const onError = (err: Error): void => rejectRef(err);
      const onAborted = (): void => rejectRef(new Error('Request aborted'));

      let resolveRef: (value: void) => void;
      let rejectRef: (err: Error) => void;

      await new Promise<void>((resolve, reject) => {
        resolveRef = resolve;
        rejectRef = reject;
        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
        req.on('aborted', onAborted);
      });

      // Clean up event listeners after body is fully consumed
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);

      if (chunks.length === 0) return;
      const raw = Buffer.concat(chunks).toString('utf8');

      if (contentType.includes('application/json')) {
        try {
          (ctx as unknown as Record<string, unknown>)['body'] = JSON.parse(raw);
        } catch {
          (ctx as unknown as Record<string, unknown>)['body'] = null;
        }
      } else {
        (ctx as unknown as Record<string, unknown>)['body'] = raw;
      }
    }
  }

  return {
    use(mw: MiddlewareFn): void {
      globalMiddlewares.push(mw);
    },

    registerController(ctor: Constructor): void {
      const controllerMeta = getControllerMeta(ctor);
      if (!controllerMeta) {
        throw new Error(`Class ${ctor.name} is not decorated with @Controller`);
      }

      const instance = container.resolve(ctor);
      const routesMeta = getRoutesMeta(ctor);

      for (const routeMeta of routesMeta) {
        const fullPath = normalizePath(controllerMeta.prefix + routeMeta.path);
        const middlewares = [...controllerMeta.middlewares, ...routeMeta.middlewares];

        const handler = async (c: StreetContext): Promise<void> => {
          const method = (instance as Record<string, unknown>)[routeMeta.handlerName];
          if (typeof method !== 'function') {
            throw new Error(`Handler ${routeMeta.handlerName} is not a function`);
          }
          await (method as (ctx: StreetContext) => Promise<void>).call(instance, c);
        };

        router.add(
          routeMeta.method,
          fullPath,
          middlewares,
          handler,
          routeMeta.validate,
          ctor.prototype as object,
          routeMeta.handlerName,
        );
        registeredRoutes.push({ method: routeMeta.method, fullPath, meta: routeMeta, controllerMeta });
      }
    },

    openApiSpec(): object {
      return generateOpenApi(registeredRoutes.map((r) => ({
        method: r.method,
        path: r.fullPath,
        summary: r.meta.openapi?.summary,
        description: r.meta.openapi?.description,
        tags: r.meta.openapi?.tags,
        responses: r.meta.openapi?.responses,
      })));
    },

    listen(port = options.port ?? 3000, host = options.host ?? '0.0.0.0'): Promise<void> {
      return new Promise((resolve, reject) => {
        const onError = (err: Error): void => {
          server.removeListener('error', onError);
          reject(err);
        };
        server.on('error', onError);
        server.listen(port, host, () => {
          server.removeListener('error', onError);
          console.log(`[street] Listening on http://${host}:${port}`);
          resolve();
        });
      });
    },

    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

function normalizePath(p: string): string {
  const s = '/' + (p ?? '');
  return s.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

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

function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary=([^\s;]+)/i);
  return match?.[1] ?? null;
}
