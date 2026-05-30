---
layout:       default
title:        "Getting Started"
nav_order:    2
has_children: true
permalink:    /getting-started/
description:  "Get started with Street Framework — install, scaffold a project, configure TypeScript, run the dev server."
---

# Getting Started

Everything you need to go from zero to a running Street application.

| Page | Description |
|---|---|
| [Installation](/street/getting-started/installation/) | Prerequisites, install, build, configure, run |
| [First Server](/street/getting-started/first-server/) | Build your first HTTP server step by step |
| [Project Structure](/street/getting-started/project-structure/) | Directory layout, conventions, file naming |
| [Configuration](/street/getting-started/configuration/) | Environment variables, `street.config.ts`, secrets |

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
