// src/browser-stub.ts
// Browser/edge fallback for Node-only subpath exports of @streetjs/core.
//
// Bundlers select this module (via the package.json "browser" export condition)
// in place of subpaths that depend on Node.js core modules — the HTTP server,
// PostgreSQL wire driver, clustering, multipart parser, websocket server, etc.
//
// It does not import any `node:*` module, so it is safe to include in a browser
// bundle. Touching any named export throws a descriptive, catchable error so the
// failure is obvious at runtime rather than producing a cryptic bundler error.
import { FeatureUnavailableInEdgeRuntimeError } from './http/exceptions.js';
function unavailable() {
    throw new FeatureUnavailableInEdgeRuntimeError('This @streetjs/core feature requires a Node.js runtime and is unavailable in a browser/edge build');
}
// A Proxy that throws on any property access or call, so that *any* named import
// from a Node-only subpath fails loudly when actually used in the browser.
const trap = new Proxy(function () { }, {
    get: () => unavailable(),
    apply: () => unavailable(),
    construct: () => unavailable(),
});
export default trap;
export const __browserStub = true;
//# sourceMappingURL=browser-stub.js.map