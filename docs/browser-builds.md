---
layout: default
title: "Browser & Edge Builds"
nav_exclude: true
---

# Browser & Edge Builds

`streetjs` ships a **browser-safe subset** that bundlers and edge runtimes select automatically through the package.json `"browser"` export condition. The browser entry exports only runtime-agnostic code (no `node:` built-ins), while every Node-only feature resolves to a stub that throws a clear, catchable error.

- Browser entry source: `packages/core/src/browser.ts` → `dist/browser.js`
- Stub source: `packages/core/src/browser-stub.ts` → `dist/browser-stub.js`
- Compatibility tests: `packages/core/src/tests/browser-build.test.ts`

---

## Overview

A backend framework can't run wholesale in a browser — it depends on `node:net`, `node:fs`, `node:crypto`, `node:http`, and friends. But a meaningful slice of `streetjs` is **pure, isomorphic logic**: exception types, XSS sanitisation, and an in-memory LRU cache. Those are safe in any JavaScript runtime.

The package solves this with [export conditions](https://nodejs.org/api/packages.html#conditional-exports):

- The main entry `'.'` resolves to a curated, node-free module (`dist/browser.js`) under the `"browser"` condition.
- Node-only subpaths (`./http`, `./database`, …) resolve to a **throwing Proxy stub** (`dist/browser-stub.js`) under the `"browser"` condition.
- A few genuinely safe subpaths (`./xss`, `./cache`, `./exceptions`) resolve to their real modules under the `"browser"` condition.

The result: a browser/edge bundle never drags a Node built-in into its dependency graph, and accidentally importing a Node-only feature fails loudly with `FeatureUnavailableInEdgeRuntimeError` instead of a cryptic bundler error.

---

## How the browser condition works

Each entry in `package.json` "exports" lists conditions **in priority order**. For the browser subset, `"browser"` is listed **before** `"import"`:

```jsonc
{
  "exports": {
    ".": {
      "browser": "./dist/browser.js",   // ← chosen by browser/edge bundlers
      "import":  "./dist/index.js",      // ← chosen by Node ESM
      "types":   "./dist/index.d.ts"
    },
    "./http": {
      "browser": "./dist/browser-stub.js",   // throwing stub
      "import":  "./dist/http/server.js",
      "types":   "./dist/http/server.d.ts"
    },
    "./xss": {
      "browser": "./dist/security/xss.js",    // real module (safe)
      "import":  "./dist/security/xss.js",
      "types":   "./dist/security/xss.d.ts"
    }
    // ...
  }
}
```

A resolver matches the **first** condition it understands. A browser-targeting bundler activates `"browser"` and resolves `dist/browser.js`; Node ESM ignores `"browser"`, falls through to `"import"`, and resolves the full `dist/index.js`. Because `"browser"` precedes `"import"`, browser builds win the curated subset while Node builds keep the complete framework.

---

## What's available in the browser

The browser entry (`dist/browser.js`) re-exports only the runtime-agnostic public API:

**Exceptions** (from `./http/exceptions.js`):

- `StreetException`
- `BadRequestException`
- `UnauthorizedException`
- `ForbiddenException`
- `NotFoundException`
- `ConflictException`
- `UnprocessableException`
- `InternalException`
- `ServiceUnavailableException`
- `DatabaseConnectionError`
- `FeatureUnavailableInEdgeRuntimeError`
- `isStreetException`

**XSS helpers** (from `./security/xss.js`):

- `sanitizeString`
- `sanitizeDeep`
- `escapeHtml`

**Cache** (from `./cache/lru.js`):

- `LruCache`
- `LruOptions` (type)

**Build marker:**

- `STREET_BUILD_TARGET` — a `const` equal to `'browser'`, useful for guards in isomorphic code.

```typescript
import {
  LruCache,
  sanitizeString,
  escapeHtml,
  NotFoundException,
  isStreetException,
  STREET_BUILD_TARGET,
} from 'streetjs';

const cache = new LruCache<string, string>({ maxSize: 256 });
cache.set('greeting', sanitizeString('<b>hi</b>'));

if (STREET_BUILD_TARGET === 'browser') {
  // isomorphic guard — runs in the browser/edge build
}
```

The browser-safe subpaths can also be imported directly:

```typescript
import { sanitizeDeep } from 'streetjs/xss';
import { LruCache } from 'streetjs/cache';
import { BadRequestException } from 'streetjs/exceptions';
```

---

## What's NOT available in the browser

Everything that requires a Node runtime resolves to the throwing stub under the `"browser"` condition. These subpaths all map to `dist/browser-stub.js`:

`./http`, `./router`, `./database`, `./pool`, `./repository`, `./migrations`, `./security`, `./session`, `./vault`, `./ratelimit`, `./websocket`, `./sse`, `./telemetry`, `./cluster`, `./cli`, `./multipart`, `./webhook`.

The stub imports **no** `node:*` module, so it is safe to include in a bundle. It exports a `Proxy` that throws `FeatureUnavailableInEdgeRuntimeError` on **any** property access, call, or construction:

```typescript
// browser-stub.ts (simplified)
import { FeatureUnavailableInEdgeRuntimeError } from './http/exceptions.js';

function unavailable(): never {
  throw new FeatureUnavailableInEdgeRuntimeError(
    'This streetjs feature requires a Node.js runtime and is unavailable in a browser/edge build',
  );
}

const trap = new Proxy(function () {} as unknown as Record<string, unknown>, {
  get:       () => unavailable(),
  apply:     () => unavailable(),
  construct: () => unavailable(),
});

export default trap;
export const __browserStub = true as const;
```

So this fails at runtime in a browser build, with a descriptive, catchable error:

```typescript
import { createServer } from 'streetjs/http';

createServer(); // throws FeatureUnavailableInEdgeRuntimeError
```

Catch it if you need a graceful fallback:

```typescript
import { isStreetException, FeatureUnavailableInEdgeRuntimeError } from 'streetjs';

try {
  doNodeOnlyThing();
} catch (err) {
  if (err instanceof FeatureUnavailableInEdgeRuntimeError) {
    // fall back to an edge-compatible path
  }
}
```

---

## Using with each bundler

All of these honour the `"browser"` export condition. The key is to make sure the browser condition is enabled (most browser-targeting tools enable it by default).

### Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    // Ensure the browser condition is preferred during resolution.
    conditions: ['browser', 'import', 'default'],
  },
  optimizeDeps: {
    // Let esbuild pre-bundle streetjs using the browser condition.
    include: ['streetjs'],
  },
});
```

### Rollup

```javascript
// rollup.config.mjs
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'src/main.js',
  output: { file: 'dist/bundle.js', format: 'es' },
  plugins: [
    nodeResolve({ browser: true }), // activates the "browser" export condition
  ],
};
```

### Webpack 5

```javascript
// webpack.config.js
module.exports = {
  // target: 'web' enables browser resolution; conditionNames makes it explicit.
  target: 'web',
  resolve: {
    conditionNames: ['browser', 'import', 'require'],
  },
};
```

### esbuild

```javascript
// build.mjs
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  platform: 'browser',        // selects the "browser" condition
  conditions: ['browser'],    // explicit, for clarity
  outfile: 'dist/bundle.js',
});
```

---

## Edge runtimes

The same browser subset runs on edge runtimes (Vercel Edge Functions, Cloudflare Workers, Deno Deploy), which resolve the `"browser"` condition and have no Node built-ins. For full request handling at the edge, use the companion `@streetjs/edge` package and its `handleEdgeRequest` helper, which adapts the Web `Request`/`Response` (Fetch) API to Street's routing without touching `node:` modules.

### Vercel Edge

```typescript
import { handleEdgeRequest } from '@streetjs/edge';

export const config = { runtime: 'edge' };

export default function handler(req: Request): Promise<Response> {
  return handleEdgeRequest(req);
}
```

### Cloudflare Workers

```typescript
import { handleEdgeRequest } from '@streetjs/edge';

export default {
  fetch(request: Request): Promise<Response> {
    return handleEdgeRequest(request);
  },
};
```

### Deno Deploy

```typescript
import { handleEdgeRequest } from '@streetjs/edge';

Deno.serve((req: Request) => handleEdgeRequest(req));
```

Within edge handlers you can freely use the browser-safe subset (`LruCache`, the `sanitize*` helpers, and the exception types). Importing a Node-only feature still throws `FeatureUnavailableInEdgeRuntimeError`.

---

## Running the compatibility tests

The compatibility suite (`packages/core/src/tests/browser-build.test.ts`) uses **esbuild** with `platform: 'browser'` and `conditions: ['browser']` to bundle the browser entry and asserts that **zero** `node:` built-ins appear in the output. It also verifies the browser entry's public shape, that the stub throws `FeatureUnavailableInEdgeRuntimeError`, and that `browser.js` contains no `node:` imports.

```bash
# from packages/core
npx tsc
node --test dist/src/tests/browser-build.test.js
```

What the suite checks:

| Test | Assertion |
| --- | --- |
| Bundle is node-free | No `require("node:…")` or `from"node:…"` for any built-in (`node:net`, `node:fs`, `node:crypto`, …) |
| Graph resolves cleanly | A browser bundle builds with **no** errors and **without** marking node built-ins external (proving the graph is truly node-free) |
| Public API present | `LruCache`, `sanitizeString`, `escapeHtml`, `NotFoundException`, `FeatureUnavailableInEdgeRuntimeError`, and `STREET_BUILD_TARGET === 'browser'` |
| Stub throws | `stub.default.anything` and `stub.default()` both throw `FeatureUnavailableInEdgeRuntimeError`; `__browserStub === true` |
| Static guarantee | `browser.js` source contains no `from "node:…"` or `require("node:…")` |

> Because esbuild's resolver honours the `"browser"` condition the same way Vite, Rollup (`@rollup/plugin-node-resolve`), and Webpack 5 do, a clean esbuild browser build is a strong signal of cross-bundler compatibility.

---

## Troubleshooting

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `FeatureUnavailableInEdgeRuntimeError` at runtime | You imported a Node-only feature (e.g. `streetjs/http`, `/database`, `/websocket`) into a browser/edge build | Move that logic to a Node process, or use the browser-safe subset (`LruCache`, `sanitize*`, exceptions). Guard with `STREET_BUILD_TARGET` if the code is isomorphic |
| Bundler pulls in `node:net` / `node:fs` / `node:crypto` | The `"browser"` condition isn't enabled in your bundler | Enable it: Vite `resolve.conditions: ['browser', …]`; Rollup `nodeResolve({ browser: true })`; Webpack 5 `resolve.conditionNames: ['browser', …]` (or `target: 'web'`); esbuild `platform: 'browser'` / `conditions: ['browser']` |
| Type errors importing a Node-only subpath in a browser app | `"types"` still points at the Node module's declarations | This is expected — the Node-only feature isn't available in the browser. Import a browser-safe subpath instead |
| Stub error has no stack context | The Proxy throws on first access | Wrap the import site in `try/catch` and check `err instanceof FeatureUnavailableInEdgeRuntimeError` to fall back gracefully |
