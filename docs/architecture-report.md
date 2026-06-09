---
layout: default
title: "Architecture Report"
nav_exclude: true
---

# Architecture Report

Evidence-based as of commit `f64621f`. Generated from source inspection,
`madge` dependency analysis, and dependency-manifest inspection.

## Packages & boundaries

| Package | Runtime deps | Role |
| --- | --- | --- |
| `@streetjs/core` | `reflect-metadata`, `ws` (2) | Framework: HTTP, router, DI, DB drivers, security, transports, observability, enterprise |
| `@streetjs/cli` | `@streetjs/core` (1) | Scaffolding, generators, migrations, diagnostics, `certify` |
| `@streetjs/edge` | none (0) | Web Fetch → Street adapter for edge runtimes |

Dependency direction is strictly downward: `edge`/`cli` → `core`; `core` → only
its two minimal third-party deps. No package depends "up". `@streetjs/edge`
carries **zero** runtime dependencies.

> Note: the framework is **dependency-light (2 prod deps)**, not literally
> zero — `ws` powers the Node WebSocket server and `reflect-metadata` powers DI
> decorators. The browser/edge build excludes both via export conditions.

## Module organization (core, ~26k LOC)

`auth · cache · cloud · cluster · config · controllers · database · dev ·
diagnostics · domain · enterprise · graphql · http · jobs · microservices ·
multipart · observability · platform · router · sdk-gen · security · services ·
tenancy · transports · versioning · webhook · websocket`

## Dependency graph analysis

`madge --circular --extensions ts src/` over **163 files**:

```
✖ Found 1 circular dependency:
1) database/mysql/mariadb.ts > database/mysql/wire.ts
```

This is the **only** cycle in the codebase. It is the base/subclass
runtime-detection seam: `MariaDbConnection extends MysqlConnection`
(`mariadb → wire`), and `MysqlConnection.connect()` uses a **dynamic** `import()`
of `mariadb.js` to return the correct subclass after reading the server
greeting (`wire ⇢ mariadb`). It is a runtime (dynamic-import) edge, **not** a
load-time cycle — the package loads and all suites pass. See
[ADR-0001](architecture-decision-records/0001-mysql-detection-seam.md) for the
accepted decision and the planned major-version remediation.

## Extension points (stable)

- **Middleware:** `app.use(fn)` / decorator-driven route middleware.
- **Plugins:** `PluginModule` lifecycle (`onLoad`/`onUnload`) with a sandboxed
  app surface; load/unload is a verified round-trip.
- **Transports:** `EventBusTransport` (Redis, RabbitMQ) and `StreamTransport`
  (Kafka, Kinesis, in-process) interfaces.
- **Storage:** `StorageAdapter` (Local, S3, GCS) for backups.
- **Secrets:** `SecretProvider` (Vault, AWS, Azure, GCP) + `SecretRotationManager`.
- **DB drivers:** PG / MySQL / SQLite share a common `DbResult` shape.

## Strengths

- Minimal, auditable dependency surface (0 npm vulnerabilities).
- Clear layering; from-scratch protocols verified against real services.
- Rich, interface-based extension model.

## Weaknesses / technical debt

- One dynamic-import cycle (MySQL detection seam) — low impact, documented.
- `core` is a large single package (~26k LOC); a future split into
  `@streetjs/core`, `@streetjs/db`, `@streetjs/transports`, `@streetjs/enterprise`
  would improve tree-shaking and boundaries (major-version effort).

## Refactoring opportunities (ranked)

1. Break the MySQL detection cycle via a factory layer above `wire`/`mariadb`
   (major version; preserves API through a re-export).
2. Sub-package split for tree-shaking and clearer ownership.
3. Per-process benchmark isolation for cleaner memory attribution.
