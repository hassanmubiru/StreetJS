// src/microservices/http2.ts
// HTTP/2 app wrapper using node:http2 createSecureServer.
// Returns a StreetApp-compatible interface.

import { createSecureServer, type Http2SecureServer, type ServerHttp2Stream, type IncomingHttpHeaders } from 'node:http2';
import { Router, notFoundHandler, errorHandler } from '../router/router.js';
import { createContext } from '../core/context.js';
import type { StreetApp, StreetAppOptions } from '../http/server.js';
import type { MiddlewareFn } from '../core/types.js';
import type { Constructor } from '../core/types.js';
import { container } from '../core/container.js';
import { getControllerMeta, getRoutesMeta } from '../core/decorators.js';
import { generateOpenApi } from '../http/openapi.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ── Internal types ─────────────────────────────────────────────────────────────

interface RegisteredRoute {
  method: string;
  fullPath: string;
  meta: ReturnType<typeof getRoutesMeta>[0];
  controllerMeta: NonNullable<ReturnType<typeof getControllerMeta>>;
}

// ── Adapter: Http2Stream → IncomingMessage-like ────────────────────────────────

function buildFakeIncomingMessage(
  headers: IncomingHttpHeaders,
  stream: ServerHttp2Stream,
  body: Buffer,
): IncomingMessage {
  const { Readable } = require('node:stream') as typeof import('node:stream');
  const readable = Readable.from([body]) as unknown as IncomingMessage;

  Object.defineProperties(readable, {
    method: { value: String(headers[':method'] ?? 'GET').toUpperCase(), writable: false },
    url: { value: String(headers[':path'] ?? '/'), writable: false },
    headers: { value: headers as Record<string, string | string[]>, writable: false },
    socket: { value: stream.session?.socket ?? null, writable: false },
  });

  return readable;
}

function buildFakeServerResponse(stream: ServerHttp2Stream): ServerResponse {
  let statusCode = 200;
  const resHeaders: Record<string, string | string[]> = {};
  let ended = false;

  const fakeRes: {
    statusCode: number;
    writableEnded: boolean;
    setHeader(name: string, value: string | string[]): void;
    getHeader(name: string): string | number | string[] | undefined;
    removeHeader(name: string): void;
    writeHead(code: number, headers?: Record<string, string | string[]>): unknown;
    end(data?: string | Buffer): void;
    once(event: string, fn: () => void): unknown;
    on(event: string, fn: () => void): unknown;
    off(event: string, fn: () => void): unknown;
    emit(event: string): boolean;
  } = {
    statusCode,
    writableEnded: false,

    setHeader(name: string, value: string | string[]): void {
      resHeaders[name.toLowerCase()] = value;
    },
    getHeader(name: string): string | number | string[] | undefined {
      return resHeaders[name.toLowerCase()];
    },
    removeHeader(name: string): void {
      delete resHeaders[name.toLowerCase()];
    },
    writeHead(code: number, headers?: Record<string, string | string[]>): typeof fakeRes {
      statusCode = code;
      (fakeRes as { statusCode: number }).statusCode = code;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          resHeaders[k.toLowerCase()] = v;
        }
      }
      return fakeRes;
    },
    end(data?: string | Buffer): void {
      if (ended) return;
      ended = true;
      (fakeRes as { writableEnded: boolean }).writableEnded = true;

      const responseHeaders: Record<string, string | string[]> = {
        ':status': String(statusCode),
        ...resHeaders,
      };

      if (!stream.destroyed) {
        stream.respond(responseHeaders);
        if (data) {
          stream.end(data);
        } else {
          stream.end();
        }
      }
    },
    once(_event: string, _fn: () => void): typeof fakeRes { return fakeRes; },
    on(_event: string, _fn: () => void): typeof fakeRes { return fakeRes; },
    off(_event: string, _fn: () => void): typeof fakeRes { return fakeRes; },
    emit(_event: string): boolean { return false; },
  };

  return fakeRes as unknown as ServerResponse;
}

// ── Pipeline runner ────────────────────────────────────────────────────────────

async function runPipeline(
  ctx: ReturnType<typeof createContext>,
  pipeline: MiddlewareFn[],
  index: number,
): Promise<void> {
  if (index >= pipeline.length) return;
  const mw = pipeline[index];
  if (!mw) return;
  await mw(ctx, () => runPipeline(ctx, pipeline, index + 1));
}

function normalizePath(p: string): string {
  const s = '/' + (p ?? '');
  return s.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

// ── streetHttp2App ─────────────────────────────────────────────────────────────

export function streetHttp2App(opts: {
  port?: number;
  key?: Buffer;
  cert?: Buffer;
} & StreetAppOptions = {}): StreetApp {
  const router = new Router();
  const globalMiddlewares: MiddlewareFn[] = [];
  const registeredRoutes: RegisteredRoute[] = [];

  const server: Http2SecureServer = createSecureServer({
    key: opts.key,
    cert: opts.cert,
    allowHTTP1: true, // Accept HTTP/1.1 fallback
  });

  server.on('stream', async (stream, headers) => {
    // Collect body
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));

    await new Promise<void>((resolve) => stream.once('end', resolve));
    const body = Buffer.concat(chunks);

    const path = String(headers[':path'] ?? '/').split('?')[0] ?? '/';
    const queryStr = String(headers[':path'] ?? '').split('?')[1] ?? '';

    const query: Record<string, string> = {};
    if (queryStr) {
      for (const [k, v] of new URLSearchParams(queryStr)) {
        query[k] = v;
      }
    }

    const fakeReq = buildFakeIncomingMessage(headers, stream, body);
    const fakeRes = buildFakeServerResponse(stream);

    const ctx = createContext(fakeReq, fakeRes, path, query);

    // Parse JSON body
    if (body.length > 0) {
      const contentType = String(headers['content-type'] ?? '');
      if (contentType.includes('application/json')) {
        try {
          (ctx as unknown as Record<string, unknown>)['body'] = JSON.parse(body.toString('utf8'));
        } catch {
          (ctx as unknown as Record<string, unknown>)['body'] = null;
        }
      } else {
        (ctx as unknown as Record<string, unknown>)['body'] = body.toString('utf8');
      }
    }

    try {
      const pipeline: MiddlewareFn[] = [
        ...globalMiddlewares,
        async (c, next) => {
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

        const handler = async (c: ReturnType<typeof createContext>): Promise<void> => {
          const method = (instance as Record<string, unknown>)[routeMeta.handlerName];
          if (typeof method !== 'function') {
            throw new Error(`Handler ${routeMeta.handlerName} is not a function`);
          }
          await (method as (ctx: typeof c) => Promise<void>).call(instance, c);
        };

        router.add(routeMeta.method, fullPath, middlewares, handler, routeMeta.validate);
        registeredRoutes.push({ method: routeMeta.method, fullPath, meta: routeMeta, controllerMeta });
      }
    },

    openApiSpec(): object {
      return generateOpenApi(
        registeredRoutes.map((r) => ({
          method: r.method,
          path: r.fullPath,
          summary: r.meta.openapi?.summary,
          description: r.meta.openapi?.description,
          tags: r.meta.openapi?.tags,
          responses: r.meta.openapi?.responses,
        })),
      );
    },

    listen(port = opts.port ?? 443, host = '0.0.0.0'): Promise<void> {
      return new Promise((resolve, reject) => {
        const onError = (err: Error): void => {
          server.removeListener('error', onError);
          reject(err);
        };
        server.on('error', onError);
        server.listen(port, host, () => {
          server.removeListener('error', onError);
          console.log(`[street/http2] Listening on https://${host}:${port}`);
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
