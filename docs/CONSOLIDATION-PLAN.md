# StreetJS Consolidation Plan

## Executive Summary

Make StreetJS appear as **ONE package** to users, not 99 packages.

- **Problem**: Users see 99 packages in npm registry
- **Solution**: Mark internal packages as private, publish only `streetjs`
- **Key Principle**: Core packages should NOT be merged (keep modular development)

---

## New Strategy: Single Published Package

### What Stays the Same
- 99 internal packages remain separate for development
- Modular testing, independent versioning, clear boundaries
- Each package has its own tsconfig, tests, build

### What Changes
- Only `streetjs` is published to npm (public)
- All `@streetjs/*` packages become `private: true` (internal only)
- Users install ONE package: `npm install streetjs`

---

## Implementation

### Step 1: Mark Internal Packages as Private

Add `"private": true` to all @streetjs/* packages that should not be published:

Internal packages to mark as private:
- @streetjs/cache
- @streetjs/cluster
- @streetjs/container
- @streetjs/context
- @streetjs/database
- @streetjs/diagnostics
- @streetjs/exceptions
- @streetjs/multipart
- @streetjs/pool
- @streetjs/postgres
- @streetjs/ratelimit
- @streetjs/repository
- @streetjs/router
- @streetjs/schema-inspector
- @streetjs/security
- @streetjs/session
- @streetjs/store
- @streetjs/telemetry
- @streetjs/webhook-dispatcher
- @streetjs/websocket
- @streetjs/xss

### Step 2: Packages That CAN Remain Public

These can stay public if they have standalone value:
- @streetjs/plugin-* (plugin ecosystem)
- @streetjs/react, @streetjs/vue (UI frameworks)
- @streetjs/client (client SDK)
- @streetjs/cli (command line tool)

### Step 3: Verify Installation

Users should only need:
```bash
npm install streetjs
```

The `streetjs` package re-exports everything from internal @streetjs/* packages via the monorepo workspace resolution.

---

## Current Architecture (Workspaces)

The monorepo already uses npm workspaces:
```json
// root package.json
{
  "workspaces": ["packages/*"]
}
```

When users install `streetjs`, npm resolves all dependencies from the workspace. The issue is that @streetjs/* packages are currently published to npm separately.

---

## Verification Commands

```bash
# After changes, verify only streetjs is public
npm view streetjs  # Should exist and be public

# Verify internal packages are private
npm view @streetjs/cache  # Should fail or show not-found (if private)
```

---

## Key Finding: NO Circular Dependencies

Earlier analysis found "circular dependencies" - they were **false positives** from comment matching. The actual dependency graph is a clean DAG with no cycles.

---

## Timeline

| Step | Description | Time |
|------|-------------|------|
| 1 | Mark internal packages as private | 1 day |
| 2 | Test installation flow | 1 day |
| 3 | Update documentation | 1 day |
| **Total** | | **3 days** |

---

## Success Criteria

1. `npm install streetjs` provides entire framework
2. @streetjs/* packages are not independently installable via npm
3. All internal development workflows preserved
4. Plugin ecosystem remains functional
