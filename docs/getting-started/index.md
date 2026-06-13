---
layout:    default
title:     "Getting Started"
nav_order: 2
has_children: true
permalink: /getting-started/
description: "Get started with StreetJS Framework — install, scaffold, configure, run."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Getting Started</span>
<h1>Getting Started</h1>
<p>Everything you need to go from zero to a running StreetJS application.</p>
</div>

| Page | Description |
|---|---|
| [Installation](/getting-started/installation/) | Prerequisites, install, build, configure, run |
| [First Server](/getting-started/first-server/) | Build your first HTTP server step by step |
| [Project Structure](/getting-started/project-structure/) | Directory layout, conventions, file naming |
| [Configuration](/getting-started/configuration/) | Environment variables, `street.config.ts`, secrets |

## Quick path

```bash
# 1. Install CLI
npm install -g @streetjs/cli

# 2. Create project
street create my-api
cd my-api

# 3. Install dependencies
npm install

# 4. Start dev server
street dev
# [street] Listening on http://0.0.0.0:3000
```

```bash
# Test it
curl http://localhost:3000/health
# {"status":"ok","uptime":1.2,...}

curl http://localhost:3000/api/items
# {"items":[],"total":0}
```
