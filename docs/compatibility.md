---
layout:      default
title:       "Compatibility Matrix"
nav_order:   16
permalink:   /compatibility/
description:  "StreetJS compatibility matrix — supported Node.js versions, database drivers, plugin/core version ranges, and upgrade paths."
---

<div class="doc-header" markdown="0">
<span class="dh-label">Compatibility</span>
<h1>Compatibility Matrix</h1>
<p>Supported runtimes, databases, and plugin/core version ranges. The Node and database rows reflect what continuous integration actually tests on every push.</p>
</div>

## Node.js

| Node.js | Status | Notes |
|---------|--------|-------|
| 22 LTS | ✅ Supported (CI-tested) | Minimum supported version |
| 24 LTS | ✅ Supported (CI-tested) | Recommended |
| 20 | ❌ End-of-life | EOL April 2026 — no longer supported |
| < 22 | ❌ Unsupported | Requires Node 22+ (NodeNext ESM, modern crypto) |

The core test suite runs against **Node 22 and Node 24** in CI (memory-safety,
wire-protocol, load, fuzz, chaos and security suites on both).

## Databases

| Database | Driver | Status |
|----------|--------|--------|
| PostgreSQL | Native wire protocol v3 (core) | ✅ Supported |
| MySQL / MariaDB | Native pool (`@streetjs/plugin-mysql`) | ✅ Supported |
| MongoDB | Native BSON + OP_MSG (`@streetjs/plugin-mongodb`) | ✅ Supported |
| SQLite | WASM (zero-config dev default) | ✅ Supported |
| Redis | RESP2 (`@streetjs/plugin-redis`) | ✅ Cache / KV |

All drivers are dependency-free (implemented over Node core or HTTPS); no `pg`,
no `mysql2`, no `mongodb` npm packages required.

## TypeScript

| TypeScript | Status |
|------------|--------|
| ≥ 5.0 (NodeNext) | ✅ Supported |
| < 5.0 | ❌ Unsupported (decorator metadata / NodeNext) |

## Plugins ↔ core

Official `@streetjs/plugin-*` packages track the core `streetjs` version line and
declare a compatible `streetjs` range. Install a plugin whose major matches your
`streetjs` major. Browse the [Plugin Marketplace](/StreetJS/plugins/marketplace/)
for current versions.

## Upgrade paths

- **Within a major** — drop-in; follow the [CHANGELOG](/StreetJS/changelog/).
- **Across a major** — run `street upgrade` (ships codemods for breaking changes)
  and consult the [upgrade guide](/StreetJS/upgrade/).
- **Release channels & windows** — see the [LTS policy](/StreetJS/lts-policy/).

> CI tests the Node and database rows above on every push; other combinations may
> work but are not continuously verified.
