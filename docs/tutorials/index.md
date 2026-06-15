---
layout:       default
title:        "Tutorials"
nav_order:    3
has_children: true
permalink:    /tutorials/
description:   "StreetJS tutorials — a guided path from your first API to authentication, realtime, PostgreSQL, and full-stack apps with React/Next/Vue."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Tutorials</span>
<h1>Tutorials</h1>
<p>A guided, beginner-to-advanced path. Every tutorial is runnable and uses only real StreetJS APIs — copy, paste, run.</p>
</div>

New to StreetJS? Start with [Getting Started](/getting-started/) to scaffold a
project, then follow the beginner track below in order.

## Beginner track

| # | Tutorial | You will learn |
|---|----------|----------------|
| 1 | [Your First StreetJS API](/tutorials/first-api/) | Routing, controllers, services, dependency injection |
| 2 | [Building a REST API](/examples/rest-api/) | CRUD, validation, error handling, pagination, OpenAPI |
| 3 | [PostgreSQL Integration](/tutorials/postgresql/) | Pool setup, migrations, queries, repositories |
| 4 | [Authentication & Authorization](/tutorials/auth/) | JWT, sessions, RBAC, MFA |
| 5 | [WebSockets & Realtime](/tutorials/realtime/) | Channels, presence, notifications |
| 6 | [Full-Stack with React](/tutorials/fullstack-react/) | `@streetjs/client` + `@streetjs/react` hooks, auth, realtime |

## Intermediate track

These build on the beginner track and combine multiple subsystems. Each links to
the relevant guide; standalone walkthroughs are published incrementally (see the
[program roadmap](/adoption/tutorials-and-examples-program/)).

| Tutorial | Primary building blocks | Reference |
|----------|-------------------------|-----------|
| Multi-Tenant SaaS | RBAC + tenancy + `@streetjs/admin-ui` | [Auth](/tutorials/auth/), [admin UI](https://www.npmjs.com/package/@streetjs/admin-ui) |
| Background Jobs & Queues | Job runner + scheduling | [Jobs guide](/jobs/) |
| Search | Search platform / Meilisearch plugin | [Examples](/examples/) |
| File Uploads & Storage | `uploadFile` + storage plugins (S3/R2) | [Storage](/storage/) |
| AI Assistant with RAG | AI streaming + `@streetjs/ai-ui` | [AI](/tutorials/fullstack-react/) |
| Event-Driven Architecture | Webhooks + realtime channels | [Realtime](/tutorials/realtime/) |

## Advanced track

| Topic | Reference |
|-------|-----------|
| High-Traffic API Design | [Performance](/performance/) |
| Zero-Trust Security Architecture | [Security](/security/), [Threat Model](/THREAT-MODEL/) |
| Observability & Monitoring | [Observability](/observability/) |
| Kubernetes Deployment | [Deployment](/deployment/) |
| Enterprise RBAC & Audit Logging | [Enterprise](/enterprise/) |

> **Scope & honesty.** Tutorials marked with a direct link are published and
> verified against the current APIs. Items that point to a guide are planned as
> standalone step-by-step tutorials and currently route you to the closest
> existing reference. The full curriculum and its delivery schedule live in the
> [Tutorials & Examples Program](/adoption/tutorials-and-examples-program/).
