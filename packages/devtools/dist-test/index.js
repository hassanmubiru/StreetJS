// @streetjs/devtools — public entry point.
//
// The Street Framework Interactive Developer Experience (Req 7): a browser
// bundle delivering the Playground, Route Explorer, Dependency Graph Visualizer,
// and API Inspector. It reuses the pure data builders from `streetjs`
// (buildRouteTree, buildDependencyGraph, inspectorSuccess/inspectorFailure,
// openApiToHtml) so the framework and the tools agree on the data model.
//
// SECURITY MODEL (declared AND enforced, Req 7.7):
//  - AuthN: token-gated. Every request the tools make against the inspected app
//    requires a bearer access token; the raw token is never stored (only its
//    SHA-256 hash) and is compared in constant time.
//  - AuthZ: read-only. Even an authenticated caller may only issue SAFE methods
//    (GET/HEAD/OPTIONS); any mutating method is rejected (403). Enforcement lives
//    in `DevtoolsAuthGate` (server side) and is mirrored in the browser client.
export { DevtoolsAuthGate, SAFE_METHODS, STATUS_FOR_DECISION, hashToken, isSafeMethod, parseBearer, } from './auth.js';
export { inspect } from './inspector.js';
export { buildDevtoolsData, demoDevtoolsData } from './data.js';
export { renderDevtoolsBundle, openApiToHtml } from './bundle.js';
//# sourceMappingURL=index.js.map