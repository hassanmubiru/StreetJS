---
layout: default
title: Migration Guide
nav_order: 7
---

# Migration Guide

This document covers version-to-version migration instructions for Street Framework.

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
