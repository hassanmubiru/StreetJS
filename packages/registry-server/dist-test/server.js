// @streetjs/registry-server — HTTP adapter (node:http, zero extra deps).
//
// Maps the RegistryApi surface to concrete routes, all under `/api/v1`:
//   POST   /api/v1/plugins                              → publish   (authn + authz)
//   GET    /api/v1/plugins                              → list      (public)
//   GET    /api/v1/plugins/search                       → search    (public)
//   GET    /api/v1/plugins/:name/versions               → versions  (public)
//   GET    /api/v1/plugins/:name/:version/download      → download  (public)
//   GET    /api/v1/plugins/:name/:version/verify        → verify    (public)
//
// `:name` may be a scoped name containing a single `/` (e.g. `@acme/widgets`),
// which is why routing is done by trailing-segment matching rather than naive
// split. Error codes map to HTTP status via `statusForError`.
import { createServer } from 'node:http';
import { parseBearer } from './auth.js';
import { isRegistryError } from './registry.js';
/** Map a registry error code to an HTTP status. */
export function statusForError(code) {
    switch (code) {
        case 'UNAUTHENTICATED':
            return 401;
        case 'UNAUTHORIZED':
            return 403;
        case 'INVALID_MANIFEST':
        case 'INTEGRITY_FAILED':
            return 422;
        case 'DUPLICATE':
            return 409;
        case 'NOT_FOUND':
            return 404;
        default:
            return 400;
    }
}
const MAX_BODY_BYTES = 64 * 1024 * 1024; // 64 MiB publish ceiling.
function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(payload);
}
function sendError(res, error) {
    sendJson(res, statusForError(error.code), { error });
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Request body exceeds maximum size'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}
/** Build the request handler for a given service (usable in tests without a socket). */
export function createRequestHandler(service) {
    return async function handle(req, res) {
        try {
            const url = new URL(req.url ?? '/', 'http://localhost');
            const method = (req.method ?? 'GET').toUpperCase();
            const path = url.pathname.replace(/\/+$/, '');
            const PREFIX = '/api/v1/plugins';
            if (!path.startsWith(PREFIX)) {
                sendError(res, { code: 'NOT_FOUND', message: 'Unknown route' });
                return;
            }
            const rest = path.slice(PREFIX.length); // '', '/search', '/:name/versions', '/:name/:version/(download|verify)'
            const segs = rest.split('/').filter((s) => s.length > 0).map((s) => decodeURIComponent(s));
            // POST /api/v1/plugins  → publish
            if (method === 'POST' && segs.length === 0) {
                const apiKey = parseBearer(req.headers.authorization);
                const raw = await readBody(req);
                let parsed;
                try {
                    parsed = JSON.parse(raw);
                }
                catch {
                    sendError(res, { code: 'INVALID_MANIFEST', message: 'Request body is not valid JSON', field: 'body' });
                    return;
                }
                const result = service.publish(apiKey, parsed, {
                    categories: parsed.categories,
                    tags: parsed.tags,
                    description: parsed.description,
                });
                if (isRegistryError(result))
                    sendError(res, result);
                else
                    sendJson(res, 201, result);
                return;
            }
            // GET routes only beyond this point.
            if (method !== 'GET') {
                sendError(res, { code: 'NOT_FOUND', message: `Method ${method} not supported on ${path}` });
                return;
            }
            // GET /api/v1/plugins  → list
            if (segs.length === 0) {
                sendJson(res, 200, service.list({
                    page: numParam(url, 'page'),
                    pageSize: numParam(url, 'pageSize'),
                }));
                return;
            }
            // GET /api/v1/plugins/search  → search
            if (segs.length === 1 && segs[0] === 'search') {
                sendJson(res, 200, service.search({
                    q: url.searchParams.get('q') ?? undefined,
                    category: url.searchParams.get('category') ?? undefined,
                    tag: url.searchParams.get('tag') ?? undefined,
                    page: numParam(url, 'page'),
                    pageSize: numParam(url, 'pageSize'),
                }));
                return;
            }
            // Trailing-action routes. The action is the last segment.
            const action = segs[segs.length - 1];
            // GET /api/v1/plugins/:name/versions
            if (action === 'versions') {
                const name = joinName(segs.slice(0, -1));
                sendJson(res, 200, service.versions(name));
                return;
            }
            // GET /api/v1/plugins/:name/:version/(download|verify)
            if ((action === 'download' || action === 'verify') && segs.length >= 3) {
                const version = segs[segs.length - 2];
                const name = joinName(segs.slice(0, -2));
                const result = action === 'download' ? service.download(name, version) : service.verify(name, version);
                if (isRegistryError(result))
                    sendError(res, result);
                else
                    sendJson(res, 200, result);
                return;
            }
            sendError(res, { code: 'NOT_FOUND', message: `Unknown route ${path}` });
        }
        catch (e) {
            sendError(res, { code: 'INTEGRITY_FAILED', message: e instanceof Error ? e.message : 'Internal error' });
        }
    };
}
/** Reassemble a (possibly scoped) plugin name from path segments. */
function joinName(segs) {
    return segs.join('/');
}
function numParam(url, key) {
    const raw = url.searchParams.get(key);
    if (raw === null)
        return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
}
/** Start an HTTP registry server bound to `port` (0 = ephemeral). */
export function createRegistryServer(service) {
    return createServer(createRequestHandler(service));
}
/** Start and begin listening; resolves once bound. */
export function startRegistryServer(service, port = 0, host = '127.0.0.1') {
    const server = createRegistryServer(service);
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            resolve({
                server,
                service,
                close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
            });
        });
    });
}
//# sourceMappingURL=server.js.map