---
layout:      default
title:       "@streetjs/plugin-mysql"
permalink:   /plugins/mysql/
nav_exclude: true
description:  "Official StreetJS plugin: MySQL/MariaDB connection pool (wraps the native, dependency-free core driver). Official, signed, dependency-free StreetJS plugin — install from npm."
---

<script type="application/ld+json">
{"@context":"https://schema.org","@type":"SoftwareSourceCode","name":"@streetjs/plugin-mysql","description":"Official StreetJS plugin: MySQL/MariaDB connection pool (wraps the native, dependency-free core driver).","codeRepository":"https://github.com/hassanmubiru/StreetJS","programmingLanguage":"TypeScript","runtimePlatform":"Node.js >= 22","softwareVersion":"1.0.2","license":"https://opensource.org/licenses/MIT","isPartOf":{"@type":"SoftwareApplication","name":"StreetJS","applicationCategory":"DeveloperApplication"}}
</script>
# @streetjs/plugin-mysql

**Official StreetJS plugin: MySQL/MariaDB connection pool (wraps the native, dependency-free core driver).**

- **Category:** [Database](/StreetJS/plugins/category/database/)
- **Tier:** Official · **Signed** · **Dependency-free**
- **Version:** `v1.0.2`
- **Runtime dependencies:** none (third-party) — only `streetjs`
- **npm:** [@streetjs/plugin-mysql](https://www.npmjs.com/package/@streetjs/plugin-mysql)
- **Source:** [packages/plugin-mysql](https://github.com/hassanmubiru/StreetJS/tree/main/packages/plugin-mysql)
- **Maintainer:** street contributors (StreetJS core team)

## Trust signals

- ✅ **Signed manifest** (Ed25519) — `manifest.signed.json` is committed and verified by the plugin host on load
- ✅ **Dependency-free** — no third-party runtime dependencies (only the `streetjs` framework)
- ✅ **MIT licensed** · **Node.js ≥ 20** · **TypeScript-native**
- ✅ **npm provenance** — official plugins are published with build attestations (enforced in CI)

## Install

```bash
npm install @streetjs/plugin-mysql
```

## Quick start

Register the plugin with the StreetJS plugin host, then use it from your
controllers/services. See the package README on npm for the full configuration
and API, and the [Plugin System](/StreetJS/plugins/) guide for registration,
capabilities and signature verification.

## Compatibility

| | |
|---|---|
| StreetJS | `^1.0.6` |
| Node.js | `>=20.0.0` |
| TypeScript | `>=5.0.0` (NodeNext) |

Derived from this package's `dependencies.streetjs`, `engines.node`, and
`peerDependencies.typescript`. See the [compatibility matrix](/StreetJS/compatibility/) for the full support grid.

## Certification

This is an **Official** plugin — maintained by the StreetJS team in the monorepo,
CI-tested, and published with a signed manifest. See the
[plugin certification levels](/StreetJS/ecosystem/plugin-certification/).

## Related plugins

- [@streetjs/plugin-mongodb](/StreetJS/plugins/mongodb/) — Official StreetJS plugin: MongoDB (dependency-free BSON + OP_MSG + SCRAM-SHA-256 client).
- [@streetjs/plugin-postgres](/StreetJS/plugins/postgres/) — Official StreetJS plugin: PostgreSQL connection pool (wraps the native, dependency-free core driver).
- [@streetjs/plugin-supabase](/StreetJS/plugins/supabase/) — Official StreetJS plugin: Supabase PostgREST data API (dependency-free HTTPS client).

Browse the full [Plugin Marketplace](/StreetJS/plugins/marketplace/) or all [Database](/StreetJS/plugins/category/database/) plugins.
