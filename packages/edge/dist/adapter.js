// packages/edge/src/adapter.ts
// Edge Runtime adapter: maps Web Fetch Request → StreetContext → Response.
/**
 * Handles an incoming Web Fetch API `Request` using a StreetApp instance.
 * This adapter converts the Web Fetch request into a StreetContext-compatible
 * shape and returns a Web Fetch `Response`.
 *
 * Compatible with Vercel Edge Functions, Cloudflare Workers, and any
 * environment implementing the WinterCG Fetch standard.
 */
export async function handleEdgeRequest(request, app) {
    // Build a minimal IncomingMessage-compatible object from the Web Request.
    const url = new URL(request.url);
    const headers = {};
    request.headers.forEach((value, key) => {
        headers[key] = value;
    });
    let bodyText;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        try {
            bodyText = await request.text();
        }
        catch {
            bodyText = undefined;
        }
    }
    // Build a response collector.
    let statusCode = 200;
    const responseHeaders = { 'content-type': 'application/json' };
    let responseBody = '';
    // Create a minimal readable stream mock for the edge body.
    const { Readable, Writable } = await import('node:stream');
    const reqStream = new Readable({
        read() {
            if (bodyText) {
                this.push(Buffer.from(bodyText, 'utf8'));
            }
            this.push(null);
        },
    });
    // Attach necessary IncomingMessage properties
    const incomingMessage = Object.assign(reqStream, {
        method: request.method,
        url: url.pathname + (url.search || ''),
        headers: {
            ...headers,
            host: url.host,
        },
        socket: { remoteAddress: '127.0.0.1' },
        httpVersion: '1.1',
        httpVersionMajor: 1,
        httpVersionMinor: 1,
        trailers: {},
        rawHeaders: Object.entries(headers).flat(),
        rawTrailers: [],
        aborted: false,
        complete: true,
        statusCode: null,
        statusMessage: null,
    });
    // Build a writable response collector (mock ServerResponse)
    const responseChunks = [];
    const resStream = new Writable({
        write(chunk, _encoding, callback) {
            responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            callback();
        },
    });
    const serverResponse = Object.assign(resStream, {
        statusCode: 200,
        statusMessage: 'OK',
        headersSent: false,
        writableEnded: false,
        writableFinished: false,
        sent: false,
        locals: {},
        getHeader(name) {
            return responseHeaders[name.toLowerCase()];
        },
        setHeader(name, value) {
            responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
            return serverResponse;
        },
        getHeaders() {
            return { ...responseHeaders };
        },
        removeHeader(name) {
            delete responseHeaders[name.toLowerCase()];
        },
        writeHead(code, hdrs) {
            statusCode = code;
            serverResponse.statusCode = code;
            if (hdrs) {
                for (const [k, v] of Object.entries(hdrs)) {
                    responseHeaders[k.toLowerCase()] = v;
                }
            }
            serverResponse.headersSent = true;
            return serverResponse;
        },
        end(data) {
            if (data) {
                responseChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8'));
            }
            statusCode = serverResponse.statusCode;
            serverResponse.writableEnded = true;
            serverResponse.writableFinished = true;
            resStream.emit('finish');
        },
        flushHeaders() { },
    });
    // Dispatch through the app — we simulate by creating context manually.
    // StreetApp doesn't expose an internal dispatch method, so we create a temporary
    // one-shot HTTP server approach using a synthetic handler invocation.
    // For edge environments, we use a direct context bridge.
    try {
        await dispatchToApp(app, incomingMessage, serverResponse);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Internal Server Error';
        return new Response(JSON.stringify({ error: 'Internal Server Error', message }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
        });
    }
    // Wait a tick for async writes to complete.
    await new Promise((resolve) => setImmediate(resolve));
    responseBody = Buffer.concat(responseChunks).toString('utf8');
    const init = {
        status: statusCode,
        headers: responseHeaders,
    };
    return new Response(responseBody || null, init);
}
/**
 * Dispatches a synthetic Node.js request/response pair through the StreetApp.
 * Uses the app's internal `_handleRequest` method for direct in-process dispatch
 * without creating a TCP server.
 */
async function dispatchToApp(app, req, res) {
    // Direct in-process dispatch using StreetApp's internal handler
    // This avoids creating a TCP server for each edge request
    const handler = app['_handleRequest'];
    if (typeof handler === 'function') {
        await new Promise((resolve) => {
            const origEnd = res.end.bind(res);
            res['end'] = (...args) => {
                const r = origEnd(...args);
                resolve();
                return r;
            };
            handler(req, res);
        });
    }
    else {
        // Fallback: if _handleRequest not available, return 501
        res.writeHead(501, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Direct dispatch not available — StreetApp._handleRequest not found' }));
    }
}
//# sourceMappingURL=adapter.js.map