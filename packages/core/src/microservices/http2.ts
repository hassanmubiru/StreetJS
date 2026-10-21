// src/microservices/http2.ts
// HTTP/2 app wrapper using node:http2 createSecureServer.
// Returns a StreetApp-compatible interface.

import { createSecureServer, type Http2SecureServer, type ServerHttp2Stream, type IncomingHttpHeaders } from 'node:http2';
import { Router, notFoundHandler, errorHandler } from '../router/router.js';
import type { ErrorResponseMode } from '../router/router.js';
import { createContext } from '../core/context.js';
import type { StreetApp, StreetAppLifecycleState, StreetAppOptions } from '../http/server.js';
import type { MiddlewareFn } from '../core/types.js';
import type { Constructor } from '../core/types.js';
import { container, createContainer } from '../core/container.js';
import type { Container } from '../core/container.js';
import { getControllerMeta, getRoutesMeta } from '../core/decorators.js';
import { generateOpenApi } from '../http/openapi.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import type { PluginModule, SandboxedApp } from '../platform/plugins/sdk.js';

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
  const ownsContainer = opts.containerOwnership === 'app';
  const appContainer: Container = opts.container ?? (ownsContainer ? createContainer() : container);
  const router = new Router();
  const globalMiddlewares: MiddlewareFn[] = [];
  const pluginMiddlewares = new Map<PluginModule, MiddlewareFn[]>();
  const pluginListeners = new Map<PluginModule, Array<() => void>>();
  const pluginCleanups = new Map<PluginModule, Array<() => void>>();
  const pluginEvents = new EventEmitter();
  const registeredRoutes: RegisteredRoute[] = [];
  let closePromise: Promise<void> | undefined;
  let listenPromise: Promise<void> | undefined;
  let lifecycleState: StreetAppLifecycleState = 'CREATED';

  const server: Http2SecureServer = createSecureServer({
    key: opts.key,
    cert: opts.cert,
    allowHTTP1: true, // Accept HTTP/1.1 fallback
  });

  server.on('stream', async (stream, headers) => {
    const abortController = new AbortController();
    let bodyEnded = false;
    let requestStarted = false;
    let requestFinished = false;
    // Collect body
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer): void => { chunks.push(chunk); };
    const onEnd = (): void => {
      bodyEnded = true;
      resolveBody?.();
    };
    let resolveBody: (() => void) | undefined;
    const onClose = (): void => {
      if (!requestFinished && (!bodyEnded || requestStarted)) abortController.abort();
      if (!bodyEnded) {
        bodyEnded = true;
        resolveBody?.();
      }
    };
    const onAborted = (): void => abortController.abort();
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('close', onClose);
    stream.once('aborted', onAborted);

    await new Promise<void>((resolve) => {
      resolveBody = resolve;
      if (bodyEnded) resolve();
    });
    const body = Buffer.concat(chunks);

    const path = String(headers[':path'] ?? '/').split('?')[0] ?? '/';
    const queryStr = String(headers[':path'] ?? '').split('?')[1] ?? '';

    const query: Record<string, string> = {};
    if (queryStr) {
      for (const [k, v] of new URLSearchParams(queryStr)) {
        query[k] = v;
      }
    }

    const fakeReq = buildFakeIncomingMessage(headers, stream as ServerHttp2Stream, body);
    const fakeRes = buildFakeServerResponse(stream as ServerHttp2Stream);

    const requestContainer = opts.requestScope ? appContainer.createScope() : undefined;
    const ctx = createContext(fakeReq, fakeRes, path, query, requestContainer, abortController.signal);
    requestStarted = true;

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
        await errorHandler(ctx, err, { response: opts.errorResponse as ErrorResponseMode | undefined });
      }
    } finally {
      requestFinished = true;
      try {
        if (requestContainer) await requestContainer.dispose();
      } finally {
        stream.removeListener('data', onData);
        stream.removeListener('end', onEnd);
        stream.removeListener('close', onClose);
        stream.removeListener('aborted', onAborted);
      }
    }
  });

  async function unloadPluginResources(plugin: PluginModule): Promise<void> {
    const added = pluginMiddlewares.get(plugin);
    if (!added) return;
    const errors: unknown[] = [];
    const sandbox: SandboxedApp = {
      use(): void {},
      on(): () => void { return () => {}; },
      addCleanup(): () => void { return () => {}; },
    };
    try {
      if (plugin.onUnload) await plugin.onUnload(sandbox);
    } catch (error) {
      errors.push(error);
    }
    for (const cleanup of [...(pluginCleanups.get(plugin) ?? [])].reverse()) {
      try { await cleanup(); } catch (error) { errors.push(error); }
    }
    for (const mw of [...added].reverse()) {
      const index = globalMiddlewares.lastIndexOf(mw);
      if (index !== -1) globalMiddlewares.splice(index, 1);
    }
    pluginListeners.delete(plugin);
    pluginCleanups.delete(plugin);
    pluginMiddlewares.delete(plugin);
    if (errors.length > 0) {
      throw new AggregateError(errors, `Plugin "${plugin.name}" cleanup failed`);
    }
  }

  return {
    container: appContainer,
    get lifecycleState(): StreetAppLifecycleState { return lifecycleState; },
    use(mw: MiddlewareFn): void {
      globalMiddlewares.push(mw);
    },

    async loadPlugin(plugin: PluginModule): Promise<void> {
      const added: MiddlewareFn[] = [];
      const sandbox: SandboxedApp = {
        use(mw: MiddlewareFn): void { globalMiddlewares.push(mw); added.push(mw); },
        on(event: string, handler: (...args: unknown[]) => void): () => void {
          pluginEvents.on(event, handler);
          const unsubscribe = (): void => { pluginEvents.off(event, handler); };
          const dispose = this.addCleanup(unsubscribe);
          const listeners = pluginListeners.get(plugin) ?? [];
          listeners.push(dispose);
          pluginListeners.set(plugin, listeners);
          return dispose;
        },
        addCleanup(cleanup: () => void): () => void {
          const cleanups = pluginCleanups.get(plugin) ?? [];
          let active = true;
          const dispose = (): void => {
            if (!active) return;
            active = false;
            const index = cleanups.indexOf(dispose);
            if (index !== -1) cleanups.splice(index, 1);
            cleanup();
          };
          cleanups.push(dispose);
          pluginCleanups.set(plugin, cleanups);
          return dispose;
        },
      };
      pluginMiddlewares.set(plugin, added);
      pluginListeners.set(plugin, []);
      pluginCleanups.set(plugin, []);
      try {
        if (plugin.onLoad) await plugin.onLoad(sandbox);
      } catch (startupError) {
        const cleanupErrors: unknown[] = [];
        try {
          for (const cleanup of [...(pluginCleanups.get(plugin) ?? [])].reverse()) {
            try { cleanup(); } catch (error) { cleanupErrors.push(error); }
          }
        } finally {
          for (const mw of [...added].reverse()) {
            const index = globalMiddlewares.lastIndexOf(mw);
            if (index !== -1) globalMiddlewares.splice(index, 1);
          }
          pluginListeners.delete(plugin);
          pluginCleanups.delete(plugin);
          pluginMiddlewares.delete(plugin);
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [startupError, ...cleanupErrors],
            `Plugin "${plugin.name}" startup and cleanup failed`,
            { cause: startupError },
          );
        }
        throw startupError;
      }
    },

    async unloadPlugin(plugin: import('../platform/plugins/sdk.js').PluginModule): Promise<void> {
      const added = pluginMiddlewares.get(plugin);
      if (!added) return;
      const sandbox: SandboxedApp = {
        use(): void {}, on(): () => void { return () => {}; }, addCleanup(): () => void { return () => {}; },
      };
      if (plugin.onUnload) await plugin.onUnload(sandbox);
      for (const cleanup of [...(pluginCleanups.get(plugin) ?? [])].reverse()) await cleanup();
      pluginListeners.delete(plugin);
      pluginCleanups.delete(plugin);
      for (const mw of [...added].reverse()) {
        const idx = globalMiddlewares.lastIndexOf(mw);
        if (idx !== -1) globalMiddlewares.splice(idx, 1);
      }
      pluginMiddlewares.delete(plugin);
    },

    registerController(ctor: Constructor): void {
      const controllerMeta = getControllerMeta(ctor);
      if (!controllerMeta) {
        throw new Error(`Class ${ctor.name} is not decorated with @Controller`);
      }

      const instance = appContainer.resolve(ctor);
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
      if (lifecycleState === 'CLOSED' || lifecycleState === 'DRAINING') {
        return Promise.reject(new Error(`Cannot listen while application is ${lifecycleState}`));
      }
      if (lifecycleState === 'RUNNING') {
        return Promise.reject(new Error('Cannot listen while application is RUNNING'));
      }
      if (listenPromise) return listenPromise;

      lifecycleState = 'STARTING';
      listenPromise = new Promise((resolve, reject) => {
        const onError = (err: Error): void => {
          server.removeListener('error', onError);
          lifecycleState = 'CREATED';
          reject(err);
        };
        server.on('error', onError);
        server.listen(port, host, () => {
          server.removeListener('error', onError);
          lifecycleState = 'RUNNING';
          console.log(`[street/http2] Listening on https://${host}:${port}`);
          resolve();
        });
      });
      return listenPromise;
    },

    close(): Promise<void> {
      closePromise ??= (async () => {
        if (lifecycleState === 'CLOSED') return;
        if (lifecycleState === 'STARTING' && listenPromise) {
          try {
            await listenPromise;
          } catch (startupError) {
            let disposeError: unknown;
            if (ownsContainer) {
              try { await appContainer.dispose(); } catch (error) { disposeError = error; }
            }
            lifecycleState = 'CLOSED';
            if (disposeError) {
              throw new AggregateError([startupError, disposeError], 'Application startup and cleanup failed', { cause: startupError });
            }
            throw startupError;
          }
        }
        lifecycleState = 'DRAINING';
        if (server.listening) {
          await new Promise<void>((resolve, reject) => {
            server.close((err) => err ? reject(err) : resolve());
          });
        }
        const pluginErrors: unknown[] = [];
        for (const plugin of [...pluginMiddlewares.keys()]) {
          try {
            await unloadPluginResources(plugin);
          } catch (error) {
            pluginErrors.push(error);
          }
        }
        const cleanupErrors = [...pluginErrors];
        if (ownsContainer) {
          try { await appContainer.dispose(); } catch (error) { cleanupErrors.push(error); }
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(cleanupErrors, 'Application resource cleanup failed');
        }
        lifecycleState = 'CLOSED';
      })();
      return closePromise;
    },

    _handleRequest(_req: import('node:http').IncomingMessage, _res: import('node:http').ServerResponse): void {
      // HTTP/2 app does not support direct HTTP/1.1 request dispatch via _handleRequest.
      // Use the HTTP/2 server's stream handler instead.
      _res.writeHead(501, { 'Content-Type': 'application/json' });
      _res.end(JSON.stringify({ error: 'HTTP/2 app: direct HTTP/1.1 dispatch not supported' }));
    },
  };
}
