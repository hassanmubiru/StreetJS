---
layout:      default
title:       "Database Plugins"
permalink:   /plugins/category/database/
nav_exclude: true
description:  "Official StreetJS Database plugins — signed, dependency-free, installable from npm."
---
# Database Plugins

Connect StreetJS to SQL and document databases with native, dependency-free drivers — no `pg`, `mysql2` or `mongodb` npm packages. Each plugin speaks the database wire protocol directly over Node core for pooling, streaming and authentication you can audit.

4 official Database plugins, all installable from npm. See the full [Plugin Marketplace](/StreetJS/plugins/marketplace/).

| Plugin | Description | Version | Links |
|--------|-------------|---------|-------|
| [@streetjs/plugin-mongodb](/StreetJS/plugins/mongodb/) | Official StreetJS plugin: MongoDB (dependency-free BSON + OP_MSG + SCRAM-SHA-256 client). | `v1.0.2` | [npm](https://www.npmjs.com/package/@streetjs/plugin-mongodb) |
| [@streetjs/plugin-mysql](/StreetJS/plugins/mysql/) | Official StreetJS plugin: MySQL/MariaDB connection pool (wraps the native, dependency-free core driver). | `v1.0.2` | [npm](https://www.npmjs.com/package/@streetjs/plugin-mysql) |
| [@streetjs/plugin-postgres](/StreetJS/plugins/postgres/) | Official StreetJS plugin: PostgreSQL connection pool (wraps the native, dependency-free core driver). | `v1.0.2` | [npm](https://www.npmjs.com/package/@streetjs/plugin-postgres) |
| [@streetjs/plugin-supabase](/StreetJS/plugins/supabase/) | Official StreetJS plugin: Supabase PostgREST data API (dependency-free HTTPS client). | `v1.0.2` | [npm](https://www.npmjs.com/package/@streetjs/plugin-supabase) |
