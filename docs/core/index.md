---
layout:       default
title:        "Core"
nav_order:    4
has_children: true
permalink:    /core/
description:  "StreetJS Framework core concepts — HTTP server, router, controllers, services, dependency injection, middleware, OpenAPI."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Core</span>
<h1>Core Concepts</h1>
<p>Controllers, routing, middleware, DI container, and OpenAPI spec generation.</p>
</div>

The core module provides the HTTP server, router, dependency injection container, and all the building blocks for a StreetJS application.

| Page | Description |
|---|---|
| [Routing](/core/routing/) | URL patterns, path parameters, query strings |
| [Controllers](/core/controllers/) | HTTP handlers, `StreetContext` API, file uploads, SSE |
| [Services](/core/services/) | Business logic, `@Injectable`, constructor injection |
| [Dependency Injection](/core/dependency-injection/) | IoC container, registration, resolution, lifecycle |
| [Middleware](/core/middleware/) | Global and per-route middleware pipeline |
| [OpenAPI](/core/openapi/) | Auto-generated OpenAPI 3.1 spec, Swagger UI |
