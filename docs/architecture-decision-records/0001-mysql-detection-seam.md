---
layout: default
title: "ADR-0001: MySQL/MariaDB runtime-detection seam"
nav_exclude: true
description: "ADR-0001: MySQL/MariaDB runtime-detection seam — StreetJS, the production-grade, memory-safe TypeScript backend framework for Node.js."
sitemap: false
noindex: true
---

# ADR-0001: MySQL/MariaDB runtime-detection seam

- Status: Accepted
- Date: 2026-06-07
- Context commit: `f64621f`

## Context

`MysqlConnection.connect()` must return a `MariaDbConnection` when the server
greeting identifies a MariaDB server, and a `MysqlConnection` otherwise.
`MariaDbConnection extends MysqlConnection`, so `mariadb.ts` statically imports
`wire.ts`. To return the subclass, `wire.ts`'s `connect()` performs a **dynamic**
`import('./mariadb.js')` after reading the greeting.

`madge` reports this as the single circular dependency in the codebase:
`database/mysql/mariadb.ts > database/mysql/wire.ts`.

## Decision

Keep the dynamic-import detection seam for now.

Rationale:
- It is a **runtime** edge (dynamic `import()`), not a load-time cycle: modules
  initialise cleanly and the full MySQL/MariaDB test suite passes (19/19 against
  real MySQL 8.0; standalone and pooled).
- The dynamic import **guarantees** the subclass is available exactly when
  detection occurs, with no eager-load or registration-ordering fragility.
- Eliminating the edge requires moving detection into a factory layer above
  `wire`/`mariadb` and having `MysqlConnection.connect()` delegate to it. Done
  naively this changes the return-type contract of a public, documented API and
  risks regressing the recently-fixed wire-protocol sequence handling.

## Consequences

- One reported cycle remains; it is contained, low-impact, and documented.
- Backward compatibility and the verified driver behaviour are preserved.

## Planned remediation (next major version)

Introduce `database/mysql/connect.ts` (a factory that imports both `wire` and
`mariadb`), make `wire.ts` free of any reference to `mariadb`, and re-export a
backward-compatible `MysqlConnection.connect` that delegates to the factory.
This removes the edge without breaking callers and will ship behind a major
version bump with migration notes.
