---
layout:       default
title:        "CLI"
nav_order:    3
has_children: true
permalink:    /cli/
description:  "StreetJS Framework CLI — street create, street dev, street build, street generate, street migrate."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">CLI</span>
<h1>CLI Reference</h1>
<p>All street commands — create, dev, build, generate, migrate — with full examples.</p>
</div>

The `@streetjs/cli` package provides the `street` command for the full project lifecycle.

```bash
npm install -g @streetjs/cli
street --version   # street v1.0.3
```

| Command | Description |
|---|---|
| [`street create <name>`](/cli/commands/#street-create-project-name) | Scaffold a new StreetJS project |
| [`street dev`](/cli/commands/#street-dev) | Start dev server with hot-reload |
| [`street build`](/cli/commands/#street-build) | Compile TypeScript for production |
| [`street start`](/cli/commands/#street-start) | Start production server |
| [`street test`](/cli/commands/#street-test) | Run test suite |
| [`street generate <type> <name>`](/cli/commands/#street-generate-type-name) | Generate controller, service, or repository |
| [`street migrate:create <name>`](/cli/commands/#street-migratecreate-name) | Create SQL migration files |
| [`street migrate:run`](/cli/commands/#street-migraterun) | Run pending migrations |

See [CLI Commands](/cli/commands/) for full documentation.
