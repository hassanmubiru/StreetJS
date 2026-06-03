// src/microservices/http2.ts
// HTTP/2 app wrapper using node:http2 createSecureServer.
// Returns a StreetApp-compatible interface.
import { createSecureServer } from 'node:http2';
import { Router, notFoundHandler, errorHandler } from '../router/router.js';
import { createContext } from '../core/context.js';
import { container } from '../core/container.js';
import { getControllerMeta, getRoutesMeta } from '../core/decorators.js';
import { generateOpenApi } from '../http/openapi.js';
// ── Adapter: Http2Stream → IncomingMessage-like ────────────────────────────────
function buildFakeIncomingMessage(headers, stream, body) {
    const { Readable } = require('node:stream');
    const readable = Readable.from([body]);
    Object.defineProperties(readable, {
        method: { value: String(headers[':method'] ?? 'GET').toUpperCase(), writable: false },
        url: { value: String(headers[':path'] ?? '/'), writable: false },
        headers: { value: headers, writable: false },
        socket: { value: stream.session?.socket ?? null, writable: false },
    });
    return readable;
}
function buildFakeServerResponse(stream) {
    let statusCode = 200;
    const resHeaders = {};
    let ended = false;
    const fakeRes = {
        statusCode,
        writableEnded: false,
        setHeader(name, value) {
            resHeaders[name.toLowerCase()] = value;
        },
        getHeader(name) {
            return resHeaders[name.toLowerCase()];
        },
        removeHeader(name) {
            delete resHeaders[name.toLowerCase()];
        },
        writeHead(code, headers) {
            statusCode = code;
            fakeRes.statusCode = code;
            if (headers) {
                for (const [k, v] of Object.entries(headers)) {
                    resHeaders[k.toLowerCase()] = v;
                }
            }
            return fakeRes;
        },
        end(data) {
            if (ended)
                return;
            ended = true;
            fakeRes.writableEnded = true;
            const responseHeaders = {
                ':status': String(statusCode),
                ...resHeaders,
            };
            if (!stream.destroyed) {
                stream.respond(responseHeaders);
                if (data) {
                    stream.end(data);
                }
                else {
                    stream.end();
                }
            }
        },
        once(_event, _fn) { return fakeRes; },
        on(_event, _fn) { return fakeRes; },
        off(_event, _fn) { return fakeRes; },
        emit(_event) { return false; },
    };
    return fakeRes;
}
// ── Pipeline runner ────────────────────────────────────────────────────────────
async function runPipeline(ctx, pipeline, index) {
    if (index >= pipeline.length)
        return;
    const mw = pipeline[index];
    if (!mw)
        return;
    await mw(ctx, () => runPipeline(ctx, pipeline, index + 1));
}
function normalizePath(p) {
    const s = '/' + (p ?? '');
    return s.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}
// ── streetHttp2App ─────────────────────────────────────────────────────────────
export function streetHttp2App(opts = {}) {
    const router = new Router();
    const globalMiddlewares = [];
    const registeredRoutes = [];
    const server = createSecureServer({
        key: opts.key,
        cert: opts.cert,
        allowHTTP1: true, // Accept HTTP/1.1 fallback
    });
    server.on('stream', async (stream, headers) => {
        // Collect body
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        await new Promise((resolve) => stream.once('end', resolve));
        const body = Buffer.concat(chunks);
        const path = String(headers[':path'] ?? '/').split('?')[0] ?? '/';
        const queryStr = String(headers[':path'] ?? '').split('?')[1] ?? '';
        const query = {};
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
                    ctx['body'] = JSON.parse(body.toString('utf8'));
                }
                catch {
                    ctx['body'] = null;
                }
            }
            else {
                ctx['body'] = body.toString('utf8');
            }
        }
        try {
            const pipeline = [
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
        }
        catch (err) {
            if (!ctx.sent) {
                await errorHandler(ctx, err);
            }
        }
    });
    return {
        use(mw) {
            globalMiddlewares.push(mw);
        },
        registerController(ctor) {
            const controllerMeta = getControllerMeta(ctor);
            if (!controllerMeta) {
                throw new Error(`Class ${ctor.name} is not decorated with @Controller`);
            }
            const instance = container.resolve(ctor);
            const routesMeta = getRoutesMeta(ctor);
            for (const routeMeta of routesMeta) {
                const fullPath = normalizePath(controllerMeta.prefix + routeMeta.path);
                const middlewares = [...controllerMeta.middlewares, ...routeMeta.middlewares];
                const handler = async (c) => {
                    const method = instance[routeMeta.handlerName];
                    if (typeof method !== 'function') {
                        throw new Error(`Handler ${routeMeta.handlerName} is not a function`);
                    }
                    await method.call(instance, c);
                };
                router.add(routeMeta.method, fullPath, middlewares, handler, routeMeta.validate);
                registeredRoutes.push({ method: routeMeta.method, fullPath, meta: routeMeta, controllerMeta });
            }
        },
        openApiSpec() {
            return generateOpenApi(registeredRoutes.map((r) => ({
                method: r.method,
                path: r.fullPath,
                summary: r.meta.openapi?.summary,
                description: r.meta.openapi?.description,
                tags: r.meta.openapi?.tags,
                responses: r.meta.openapi?.responses,
            })));
        },
        listen(port = opts.port ?? 443, host = '0.0.0.0') {
            return new Promise((resolve, reject) => {
                const onError = (err) => {
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
        close() {
            return new Promise((resolve, reject) => {
                server.close((err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
        },
    };
}
//# sourceMappingURL=http2.js.map