# StreetJS Consolidation Plan

## Executive Summary

Transform StreetJS from **99 packages** into **1 framework package** with internal modules.

- **Current**: 99 npm packages, complex dependency management
- **Target**: 1 `streetjs` package with bundled internal modules
- **Timeline**: ~2-3 weeks
- **Breaking Changes**: Plugin API maintained, some subpath imports change
- **Progress**: 7 packages consolidated (exceptions, diagnostics, cache, store, cluster, xss, telemetry)

---

## Phase 1 Analysis Results

### Package Distribution

| Category | Count | Examples |
|----------|-------|----------|
| Core Dependencies | 21 | container, router, websocket, postgres, security |
| Feature Modules | 15 | events, queue, realtime, workflow, storage |
| API Integrations | 8 | github, slack, discord, jira, linear |
| Plugin Connectors | 20 | plugin-stripe, plugin-redis, plugin-kafka |
| UI Frameworks | 6 | react, vue, next, nuxt, admin-ui |
| Client SDKs | 3 | client, client-offline, http-client |
| Reference Apps | 9 | commerce, dating-*, social-* |
| Utilities | 8 | logging, metrics, tracing, config |
| Meta Packages | 2 | core-compat, database |

### Dependencies Graph

```
PHASE 1 (50 packages - no internal deps):
  admin, ai, cache, cluster, config, container, diagnostics, edge, exceptions,
  flags, health, http-client, i18n, integrations, metrics, multipart, orm,
  plugin-*, postgres, registry-server, security, session, social-comments,
  store, telemetry, tracing, webhooks, websocket, xss

PHASE 2 (37 packages - depends on Phase 1):
  ai-router, media, next, react, vue, logging, testing,
  discord, github, gitlab, jira, linear, notion, slack, teams,
  context, pool, schema-inspector, notifications, webhook-dispatcher,
  admin-ui, ai-ui, auth-ui, nuxt, ratelimit, repository, migrations,
  realtime, router, database, queue, events, storage, search,
  workflow, gateway

PHASE 3 (12 packages - circular or complex):
  core, devtools, dating-*, social-*, plugin-marzpay, plugin-redis
```

### Circular Dependencies Found: NONE (False Positive)

Earlier analysis incorrectly detected "circular dependencies" - they were false positives from comment matching. The dependency graph is actually a clean DAG with no cycles.

### Consolidation Progress

**✅ CONSOLIDATED (7 packages):**
1. `@streetjs/exceptions` → `src/http/exceptions.ts`
2. `@streetjs/diagnostics` → `src/diagnostics/reporter.ts`
3. `@streetjs/cache` → `src/cache/lru.ts`
4. `@streetjs/store` → `src/security/store.ts`
5. `@streetjs/cluster` → `src/cluster/coordinator.ts`
6. `@streetjs/xss` → `src/security/xss.ts`
7. `@streetjs/telemetry` → `src/telemetry/tracker.ts`

**🔲 REMAINING (14 core packages):**
- container, context, webhook-dispatcher, websocket, router, multipart
- postgres, pool, repository, migrations, schema-inspector
- security (jwt, session, ratelimit - some have complex dependencies)

---

## Consolidation Strategy

### Option A: Full Consolidation (Recommended)

Merge all source code into single `streetjs` package with internal module directories.

```
streetjs/
├── src/
│   ├── core/           # Container, DI, Config
│   ├── http/           # Server, Router, Middleware
│   ├── database/       # Postgres, Pool, Repository, Migrations
│   ├── security/       # JWT, Session, Rate limiting, XSS
│   ├── realtime/       # WebSocket, SSE, Channels
│   ├── queue/          # Background jobs
│   ├── events/         # Event system
│   ├── storage/        # Object storage
│   ├── plugins/        # All plugin implementations
│   ├── integrations/   # GitHub, Slack, etc.
│   └── index.ts        # Main export
├── dist/
└── package.json
```

**Pros**:
- Single `npm install streetjs`
- No dependency hell
- Easier to maintain
- Tree-shaking still works with ES modules

**Cons**:
- Larger package size
- Longer build times
- Must carefully manage exports

### Option B: Hybrid (Monorepo + Single Publish)

Keep internal package structure for development, publish only one package to npm.

**Pros**:
- Maintains modular development
- Single install for users

**Cons**:
- Complex build pipeline
- Need to manage internal deps differently

### Option C: Logical Bundles

Group into 5-10 logical bundles:
- `@streetjs/core` - essential framework
- `@streetjs/database` - PostgreSQL + ORM
- `@streetjs/realtime` - WebSocket + SSE
- `@streetjs/ai` - AI providers
- `@streetjs/plugins` - all plugins

---

## Implementation Steps

### Step 1: Fix Circular Dependencies

```typescript
// Create social-types package (NEW)
src/social/types.ts  // Shared types for social packages

// Fix social-feed and social-users
// Remove direct import, use types from social-types
```

```typescript
// Fix core/devtools cycle
// Use dynamic import for devtools in core
// Or create a devtools interface that core defines
```

### Step 2: Create Consolidated Source Structure

```bash
# Create new consolidated package structure
streetjs-consolidated/
├── src/
│   ├── container/     # From @streetjs/container
│   ├── context/       # From @streetjs/context
│   ├── diagnostics/   # From @streetjs/diagnostics
│   ├── exceptions/    # From @streetjs/exceptions
│   ├── xss/           # From @streetjs/xss
│   ├── security/      # From @streetjs/security
│   ├── session/       # From @streetjs/session
│   ├── ratelimit/     # From @streetjs/ratelimit
│   ├── multipart/     # From @streetjs/multipart
│   ├── router/        # From @streetjs/router
│   ├── http/          # From @streetjs/http (core server)
│   ├── websocket/     # From @streetjs/websocket
│   ├── sse/           # From @streetjs/websocket/sse
│   ├── postgres/      # From @streetjs/postgres
│   ├── pool/          # From @streetjs/pool
│   ├── repository/    # From @streetjs/repository
│   ├── migrations/    # From @streetjs/migrations
│   ├── schema-inspector/  # From @streetjs/schema-inspector
│   ├── webhook-dispatcher/ # From @streetjs/webhook-dispatcher
│   ├── telemetry/     # From @streetjs/telemetry
│   ├── cache/          # From @streetjs/cache
│   ├── cluster/        # From @streetjs/cluster
│   ├── store/           # From @streetjs/store
│   ├── edge/            # From @streetjs/edge
│   ├── events/          # From @streetjs/events
│   ├── queue/           # From @streetjs/queue
│   ├── realtime/        # From @streetjs/realtime
│   ├── storage/          # From @streetjs/storage
│   ├── workflow/        # From @streetjs/workflow
│   ├── gateway/          # From @streetjs/gateway
│   ├── plugins/         # All plugin-* source
│   ├── integrations/    # GitHub, Slack, etc.
│   ├── utils/           # config, flags, health, i18n, logging, metrics, testing, tracing
│   └── index.ts
├── package.json
└── tsconfig.json
```

### Step 3: Update Build System

```json
{
  "name": "streetjs",
  "version": "2.0.0",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./http": { "import": "./dist/http/server.js" },
    "./router": { "import": "./dist/router/router.js" },
    // ... preserve all existing subpath exports
  },
  "dependencies": {
    "reflect-metadata": "^0.2.2",
    "ws": "^8.21.3",
    "zod": "^4.4.3"
  }
}
```

### Step 4: Migration Path for Users

1. **New users**: `npm install streetjs` (works as before)
2. **Existing users**:
   - Plugin users: No changes needed
   - Subpath users: Update imports (`@streetjs/ratelimit` → `streetjs/ratelimit`)

### Step 5: Deprecation & Backwards Compatibility

```typescript
// DEPRECATED: @streetjs/ratelimit
// NEW: streetjs/ratelimit or import { RateLimiter } from 'streetjs'

// But for backwards compat, we can still publish stub packages:
@streetjs/ratelimit -> streetjs/ratelimit (re-export)
```

---

## Estimated Timeline

| Step | Description | Time |
|------|-------------|------|
| 1 | Fix circular dependencies | 2 days |
| 2 | Create consolidated structure | 3 days |
| 3 | Merge source code | 4 days |
| 4 | Update build & exports | 2 days |
| 5 | Test & fix issues | 3 days |
| 6 | Update docs & examples | 2 days |
| **Total** | | **16 days** |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Build time increase | Medium | Use incremental builds (tsc --build) |
| Package size bloat | Medium | ES modules enable tree-shaking |
| Breaking changes | High | Provide migration guide, deprecation period |
| Circular deps | High | Fix before merge |
| Plugin ecosystem | Medium | Maintain Plugin API interface |

---

## Success Criteria

1. ✅ `npm install streetjs` works and includes all core functionality
2. ✅ All existing tests pass
3. ✅ Plugin API remains compatible
4. ✅ No circular dependencies
5. ✅ Build time < 5 minutes (local)
6. ✅ Bundle size reasonable (< 500KB gzipped core)
