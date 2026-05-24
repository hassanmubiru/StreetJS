// src/core/context.ts
// Strict request/response context passed through middleware and handlers.
export function createContext(req, res, path, query) {
    let _sent = false;
    const headers = {};
    for (const [key, val] of Object.entries(req.headers)) {
        if (val !== undefined) {
            headers[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val;
        }
    }
    const ctx = {
        req,
        res,
        path,
        method: (req.method ?? 'GET').toUpperCase(),
        params: {},
        query,
        headers,
        body: null,
        files: [],
        state: {},
        user: null,
        startTime: process.hrtime.bigint(),
        get sent() {
            return _sent;
        },
        json(data, status = 200) {
            if (_sent)
                return;
            _sent = true;
            const body = JSON.stringify(data);
            res.writeHead(status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Length': Buffer.byteLength(body, 'utf8').toString(),
                'X-Content-Type-Options': 'nosniff',
            });
            res.end(body);
        },
        text(data, status = 200) {
            if (_sent)
                return;
            _sent = true;
            res.writeHead(status, {
                'Content-Type': 'text/plain; charset=utf-8',
                'Content-Length': Buffer.byteLength(data, 'utf8').toString(),
            });
            res.end(data);
        },
        html(data, status = 200) {
            if (_sent)
                return;
            _sent = true;
            res.writeHead(status, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Length': Buffer.byteLength(data, 'utf8').toString(),
                'X-Content-Type-Options': 'nosniff',
            });
            res.end(data);
        },
        send(status) {
            if (_sent)
                return;
            _sent = true;
            res.writeHead(status);
            res.end();
        },
        setHeader(name, value) {
            res.setHeader(name, value);
        },
        cookie(name) {
            const header = req.headers.cookie ?? '';
            for (const part of header.split(';')) {
                const [k, ...rest] = part.trim().split('=');
                if (k?.trim() === name) {
                    return decodeURIComponent(rest.join('='));
                }
            }
            return undefined;
        },
        setCookie(name, value, options = {}) {
            const parts = [`${name}=${encodeURIComponent(value)}`];
            if (options.httpOnly)
                parts.push('HttpOnly');
            if (options.secure)
                parts.push('Secure');
            if (options.sameSite)
                parts.push(`SameSite=${options.sameSite}`);
            if (options.maxAge !== undefined)
                parts.push(`Max-Age=${options.maxAge}`);
            if (options.path)
                parts.push(`Path=${options.path}`);
            if (options.domain)
                parts.push(`Domain=${options.domain}`);
            res.setHeader('Set-Cookie', parts.join('; '));
        },
    };
    return ctx;
}
//# sourceMappingURL=context.js.map