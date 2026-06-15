---
layout:       default
title:        "Examples"
nav_order:    11
has_children: true
permalink:    /examples/
description:  "StreetJS Framework examples — REST API, WebSocket chat, file upload, authentication, SSE notifications."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Examples</span>
<h1>Examples</h1>
<p>Complete, runnable examples for REST APIs, WebSocket chat, file uploads, and auth flows.</p>
</div>

Complete, runnable examples for common StreetJS Framework use cases.

| Example | Description |
|---|---|
| [REST API](/examples/rest-api/) | CRUD endpoints with PostgreSQL, pagination, OpenAPI |
| [WebSocket Chat](/examples/websocket-chat/) | Real-time chat with rooms and JWT auth |
| [File Upload](/examples/file-upload/) | Streaming multipart upload with validation |
| [User API](/examples/user-api/) | Full user management with auth, roles, sessions |
| [Streaming Query](/examples/streaming-query/) | Stream large PostgreSQL result sets row-by-row |

All examples assume you have run `street create my-app` and have a working StreetJS project.

## Starter apps & templates

Scaffold a complete project for a domain in one command — each template overlays
domain packages and a starter module on the base app:

```bash
street create my-shop --template ecommerce      # products, inventory, carts, orders
street create my-saas --template saas           # users, roles (RBAC), audit log
street create my-chat --template realtime-chat  # WebSocket channels, presence, typing
street create my-date --template dating-app     # encrypted profiles, likes, matching
```

Add a typed frontend (Vite React or Next.js App Router) and a CI workflow:

```bash
street create my-app --template saas --frontend react
street create my-app --template ecommerce --frontend next
```

| Template | What you get | Tutorial |
|----------|--------------|----------|
| `app` (default) | HTTP, DI, PostgreSQL, health checks | [First API](/tutorials/first-api/) |
| `saas` | User/role admin + audit log | [Auth](/tutorials/auth/) |
| `ecommerce` | Catalog, inventory, carts, orders | [REST API](/examples/rest-api/) |
| `realtime-chat` | Channels, presence, typing | [Realtime](/tutorials/realtime/) |
| `dating-app` | Profiles, likes, reciprocal matching | [PostgreSQL](/tutorials/postgresql/) |

## Reference example pages

| Example | Description |
|---------|-------------|
| [Todo API](/examples/todo-api/) | The smallest end-to-end CRUD service — great first build |
| [REST API](/examples/rest-api/) | Full CRUD + pagination + OpenAPI |
| [WebSocket Chat](/examples/websocket-chat/) | Rooms + JWT auth |
| [File Upload](/examples/file-upload/) | Streaming multipart upload |

> Building the broader catalog (Blog API, URL Shortener, CRM, Marketplace,
> AI Knowledge Base, …) is tracked in the
> [Tutorials & Examples Program](/adoption/tutorials-and-examples-program/), which
> lists what is published versus planned. We add runnable examples incrementally
> rather than shipping stubs.

