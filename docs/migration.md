---
layout: default
title: Migration Guide
nav_order: 7
description: "Migrate to StreetJS — move from @streetjs/core to streetjs, or from Express, with this step-by-step guide."
---

# Migration Guide

This document covers version-to-version migration instructions for StreetJS Framework.

## Package rename: `@streetjs/core` → `streetjs`

The framework's primary package was renamed from **`@streetjs/core`** to
**`streetjs`**. The old package is now a deprecated backward-compatibility shim
that re-exports `streetjs` unchanged — the export surface is identical.

**New projects:**

```diff
- npm install @streetjs/core
+ npm install streetjs
```

```diff
- import { streetApp, Controller, Get } from '@streetjs/core';
+ import { streetApp, Controller, Get } from 'streetjs';
```

Subpath imports map 1:1 as well (`@streetjs/core/http` → `streetjs/http`,
`/router`, `/database`, `/security`, …).

**Existing projects** require no immediate change: `@streetjs/core` continues to
work because it re-exports `streetjs`. To migrate, update your dependency and
rewrite the import specifier as above. There are **no API changes** — every named
export and subpath is preserved (verified by the export-parity test suite).

> `@streetjs/core` is deprecated and will only receive the re-export shim going
> forward. Please migrate to `streetjs`.

## Runtime: Migrating from Node 20 → Node 22

StreetJS now targets the supported Node.js LTS lines. **Node 20 reached
end-of-life in April 2026** and is no longer supported.

| Item | Before | After |
|------|--------|-------|
| Minimum runtime | Node.js ≥ 20 | **Node.js ≥ 22** |
| CI-tested lines | Node 20, 22 | **Node 22, 24** |
| Recommended npm | npm ≥ 9 | **npm ≥ 10** (bundled with Node 22) |
| Package manager | npm (workspaces) | npm (workspaces) — unchanged |
| Container base image | `node:20-alpine` | `node:24-alpine` (latest LTS) |
| Distroless runtime | `distroless/nodejs20` | `distroless/nodejs22` |

### What you need to do

1. **Install Node 22 or 24.** Use [nodejs.org](https://nodejs.org) or a version
   manager (`nvm install 22 && nvm use 22`). Verify with `node --version` (or run
   `npx street doctor`, which now requires Node ≥ 22).
2. **Update your `engines` field** if you pin it:
   ```diff
   - "engines": { "node": ">=20.0.0", "npm": ">=9.0.0" }
   + "engines": { "node": ">=22.0.0", "npm": ">=10.0.0" }
   ```
3. **Update Dockerfiles** to a supported LTS base image (digest-pin for
   reproducibility):
   ```diff
   - FROM node:20-alpine
   + FROM node:24-alpine
   ```
4. **Update CI matrices** from `['20', '22']` to `['22', '24']`.

### Breaking changes

- **Node 20 is rejected at the engine boundary.** With `engines.node >=22.0.0`,
  installs on Node 20 will warn (or fail under `engine-strict`/CI), and
  `street doctor` reports Node < 22 as a failure.
- **No source API changes.** StreetJS already used modern, stable Node APIs
  (native `fetch`, `node:test`, top-level `await`, `crypto.randomUUID()`,
  Web Streams, `AbortSignal`); no application code changes are required to run
  on Node 22/24. There are **no removed StreetJS exports** in this migration.
- There are **no known runtime breaking changes** between Node 20 and Node 22/24
  that affect StreetJS's public surface. If you depend on third-party native
  modules, rebuild them against your new Node version.

> Validation note: the Node 22/24 runtime behavior of this repository is
> exercised by the CI matrix (Node 22 + 24). Local Node 22/24 execution was not
> performed as part of authoring this guide.

## v1.x → v2.0

### Breaking Changes

**Router API**

The `Router` class no longer accepts a `prefix` option in the constructor. Use `@Controller` prefix instead.

```typescript
// Before (v1.x)
const router = new Router({ prefix: '/api' });

// After (v2.0)
@Controller('/api')
class ApiController { ... }
```

**Pool Configuration**

`PgPool` now requires explicit `minConnections` and `maxConnections`:

```typescript
// Before (v1.x)
new PgPool({ host, port, user, password, database });

// After (v2.0)
new PgPool({
  host, port, user, password, database,
  minConnections: 2,
  maxConnections: 10,
});
```

### New in v2.0

- Multi-tenancy with `TenantPoolRegistry`
- RBAC with `RbacService`
- OAuth2/OIDC with `OAuthManager`
- WebAuthn/Passkeys with `WebAuthnService`
- Job queue with `JobQueue` and `CronScheduler`
- Workflow engine with `WorkflowEngine`

### Database Migrations

Run the following after upgrading:

```bash
street migrate:run
```

New migration tables added: `street_sessions`, `street_audit_log`, `street_refresh_tokens`, `street_api_keys`, `street_webauthn_credentials`.

## v2.0 → v2.1

### Changes

**Multi-region replication**

The `ReplicationCoordinator` now requires explicit `RegionConfig[]`:

```typescript
const coordinator = new ReplicationCoordinator([
  { name: 'us-east', pool: primaryPool, primary: true },
  { name: 'eu-west', pool: replicaPool, readWeight: 1 },
]);
```

**Feature Flags**

Feature flag rules are now evaluated with OR semantics (any matching rule enables the flag).

```bash
# Apply feature flags migration
street migrate:run
```

## v2.1 → v2.2 (Enterprise)

### New Features

- `AuditLogger` with HMAC hash-chain signing
- `@RetainFor`, `@Encrypt`, `@Classify` property decorators
- `RetentionJob` for automated data purging
- `ComplianceReporter` for regulatory reporting
- `BackupService` with `LocalStorageAdapter`

### Database Migrations

Add these SQL blocks to your migration files:

```sql
-- Feature flags
CREATE TABLE IF NOT EXISTS street_feature_flags (
  name TEXT PRIMARY KEY,
  enabled BOOLEAN DEFAULT false,
  rules JSONB DEFAULT '[]',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enterprise audit log
CREATE TABLE IF NOT EXISTS street_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  before_state JSONB,
  after_state JSONB,
  ip TEXT,
  user_agent TEXT,
  batch_id UUID,
  signature TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backups registry
CREATE TABLE IF NOT EXISTS street_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  size_bytes BIGINT,
  duration_ms INT,
  checksum TEXT,
  storage_key TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## v2.2 → v3.0 (Platform)

### New Features

- `DistributedCache` with `InProcessCacheTransport`
- `GlobalConfigService` with pub/sub config propagation
- `EventStreamConsumer` and `RealtimeAggregator`
- `ReplicationCoordinator` with automatic failover
- AI Toolkit: `OpenAiClient`, `AnthropicClient`, `OllamaClient`, `AgentExecutor`
- Plugin Marketplace: `PluginModule`, `PluginInstaller`
- Edge Runtime: `handleEdgeRequest` adapter

### Breaking Changes

**`InProcessTransport` renamed**

The `InProcessTransport` in `@streetjs/core/microservices` is unchanged. The new `InProcessStreamTransport` is in `event-streaming.ts` — these are separate classes.

### Upgrade Steps

1. Update `@streetjs/core` to `^3.0.0`
2. Update `@streetjs/cli` to `^3.0.0`
3. Run `street migrate:run`
4. Update any custom middleware that accesses `ctx.state['readPool']` — this is now set by `preferredRegionMiddleware`
