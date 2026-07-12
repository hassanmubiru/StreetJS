// src/http/server.ts
// Core HTTP server: body parsing, routing, lifecycle hooks, OpenAPI registration.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
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
import { EventEmitter } from 'node:events';
import type { PluginModule, SandboxedApp } from '../platform/plugins/sdk.js';

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
  /** Load a marketplace plugin: runs onLoad with a sandboxed app view. */
  loadPlugin(plugin: PluginModule): Promise<void>;
  /** Unload a plugin: runs onUnload and restores the middleware stack. */
  unloadPlugin(plugin: PluginModule): Promise<void>;
  /** Internal: direct in-process request handler. Used by edge adapter and tests. */
  _handleRequest(req: IncomingMessage, res: ServerResponse): void;
}

interface RegisteredRoute {
  method: string;
  fullPath: string;
  meta: RouteMetadata;
  controllerMeta: ControllerMetadata;
}

/**
 * A {@link StreetApp} that also exposes its underlying Node `http.Server`, so a
 * `StreetWebSocketServer` can be attached to the same server that serves HTTP:
 *   `wsServer.attach(app.server, connectionHandler)` before `app.listen()`.
 * This is the return type of the standard {@link streetApp} factory.
 */
export interface StreetHttpApp extends StreetApp {
  readonly server: Server;
}

export function streetApp(options: StreetAppOptions = {}): StreetHttpApp {
  const router = new Router();
  const globalMiddlewares: MiddlewareFn[] = [...(options.globalMiddlewares ?? [])];
  const registeredRoutes: RegisteredRoute[] = [];
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const uploadsDir = options.uploadsDir ?? './uploads';
  const pluginEvents = new EventEmitter();
  const pluginMiddlewares = new Map<PluginModule, MiddlewareFn[]>();

  /** The core per-request handler extracted for direct in-process dispatch. */
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res);
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
    server,

    use(mw: MiddlewareFn): void {
      globalMiddlewares.push(mw);
    },

    async loadPlugin(plugin: PluginModule): Promise<void> {
      if (pluginMiddlewares.has(plugin)) {
        throw new Error(`Plugin "${plugin.name}" is already loaded`);
      }
      const added: MiddlewareFn[] = [];
      const sandbox: SandboxedApp = {
        use(mw: MiddlewareFn): void {
          globalMiddlewares.push(mw);
          added.push(mw);
        },
        on(event: string, handler: (...args: unknown[]) => void): void {
          pluginEvents.on(event, handler);
        },
      };
      pluginMiddlewares.set(plugin, added);
      if (plugin.onLoad) await plugin.onLoad(sandbox);
    },

    async unloadPlugin(plugin: PluginModule): Promise<void> {
      const added = pluginMiddlewares.get(plugin);
      if (!added) return;
      const sandbox: SandboxedApp = {
        use(): void { /* no-op during unload */ },
        on(): void { /* no-op during unload */ },
      };
      if (plugin.onUnload) await plugin.onUnload(sandbox);
      // Restore the middleware stack to its pre-load state.
      for (const mw of added) {
        const idx = globalMiddlewares.indexOf(mw);
        if (idx !== -1) globalMiddlewares.splice(idx, 1);
      }
      pluginMiddlewares.delete(plugin);
    },

    _handleRequest(req: IncomingMessage, res: ServerResponse): void {
      void handleRequest(req, res);
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
