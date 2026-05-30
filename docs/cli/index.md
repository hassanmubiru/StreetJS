---
layout:       default
title:        "CLI"
nav_order:    3
has_children: true
permalink:    /cli/
description:  "Street Framework CLI — street create, street dev, street build, street generate, street migrate."
---

# CLI Reference

The `@streetjs/cli` package provides the `street` command for the full project lifecycle.

```bash
npm install -g @streetjs/cli
street --version   # street v1.0.3
```

| Command | Description |
|---|---|
| [`street create <name>`](/street/cli/commands/#street-create-project-name) | Scaffold a new Street project |
| [`street dev`](/street/cli/commands/#street-dev) | Start dev server with hot-reload |
| [`street build`](/street/cli/commands/#street-build) | Compile TypeScript for production |
| [`street start`](/street/cli/commands/#street-start) | Start production server |
| [`street test`](/street/cli/commands/#street-test) | Run test suite |
| [`street generate <type> <name>`](/street/cli/commands/#street-generate-type-name) | Generate controller, service, or repository |
| [`street migrate:create <name>`](/street/cli/commands/#street-migratecreate-name) | Create SQL migration files |
| [`street migrate:run`](/street/cli/commands/#street-migraterun) | Run pending migrations |

See [CLI Commands](/street/cli/commands/) for full documentation.
