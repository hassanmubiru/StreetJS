---
layout:    default
title:     "Roadmap"
nav_order: 15
permalink: /roadmap/
description: "Street Framework roadmap — planned features, upcoming releases, and long-term vision."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Project</span>
<h1>Roadmap</h1>
<p>Planned features, upcoming releases, and the long-term vision for Street Framework.</p>
</div>

This page tracks planned features and improvements for Street Framework. Items are grouped by release milestone. Priorities shift based on community feedback — open an issue or discussion to influence the roadmap.

---

## v1.1 — Developer Experience

**Target:** Q3 2026

- [ ] **`street dev` hot-reload** — use `node --watch` instead of manual `fs.watch` for more reliable file change detection
- [ ] **`street generate middleware <name>`** — generate middleware boilerplate
- [ ] **`street generate gateway <name>`** — generate WebSocket gateway boilerplate
- [ ] **`street generate migration <name>`** — alias for `street migrate:create`
- [ ] **Config validation** — validate `street.config.ts` at startup and print actionable errors
- [ ] **Better error messages** — structured error output with file/line references for common mistakes (missing `reflect-metadata`, wrong tsconfig, etc.)
- [ ] **`street info`** — print project info, versions, and environment diagnostics

---

## v1.2 — Database

**Target:** Q4 2026

- [ ] **MySQL/MariaDB wire driver** — native MySQL protocol implementation (no `mysql2` dependency)
- [ ] **SQLite support** — via `node:sqlite` (Node 22+)
- [ ] **Query builder** — fluent, type-safe query builder that compiles to parameterized SQL
- [ ] **Schema introspection** — generate TypeScript types from an existing database schema
- [ ] **Migration diffing** — detect schema drift between migrations and current database state

---

## v1.3 — Observability

**Target:** Q1 2027

- [ ] **OpenTelemetry integration** — traces, metrics, and logs via OTLP exporter
- [ ] **Structured logging** — built-in JSON logger with request correlation IDs
- [ ] **Health check DSL** — declarative health checks for database, cache, external services
- [ ] **Prometheus metrics endpoint** — expose `/metrics` in Prometheus text format
- [ ] **Distributed tracing** — W3C `traceparent` header propagation

---

## v1.4 — Auth

**Target:** Q2 2027

- [ ] **OAuth 2.0 / OIDC** — built-in provider integrations (Google, GitHub, Microsoft)
- [ ] **Refresh token rotation** — automatic JWT refresh with sliding expiry
- [ ] **API key authentication** — header-based API key middleware with rate limiting per key
- [ ] **RBAC helpers** — role-based access control decorators (`@RequireRole`, `@RequirePermission`)
- [ ] **Passkey / WebAuthn** — FIDO2 authentication support

---

## v2.0 — Architecture

**Target:** 2027

- [ ] **HTTP/2 support** — native `node:http2` server with multiplexing
- [ ] **gRPC support** — Protocol Buffers + gRPC server via `node:net`
- [ ] **Message queue integration** — built-in adapters for Redis Streams, NATS, and RabbitMQ
- [ ] **Microservice toolkit** — service discovery, circuit breaker, retry policies
- [ ] **Edge runtime** — compatibility layer for Cloudflare Workers and Deno Deploy

---

## Completed

### v1.0 ✅

- [x] HTTP server (`node:http`)
- [x] Compiled-regex router with parameter extraction
- [x] IoC container with constructor injection
- [x] PostgreSQL wire protocol v3 (SCRAM-SHA-256, MD5, cleartext auth)
- [x] Connection pool with bounded acquire queue
- [x] Repository pattern with parameterized queries
- [x] SQL migration runner with tracking table
- [x] JWT (HMAC-SHA256, `timingSafeEqual`)
- [x] Sessions (AES-256-GCM, random IV)
- [x] Vault mode (scrypt + AES-256-GCM)
- [x] Sliding-window rate limiter (BigInt nanosecond precision)
- [x] XSS sanitizer (recursive deep sanitization)
- [x] Security headers middleware
- [x] CORS middleware
- [x] WebSocket server (bounded, heartbeat, typed events)
- [x] Server-Sent Events (heartbeat, backpressure)
- [x] Streaming multipart file upload (≤128 KB heap)
- [x] LRU cache (TTL, O(1) eviction)
- [x] Telemetry tracker (ring buffer, P50/P99 latency)
- [x] Cluster coordinator (`node:cluster`, IPC heartbeat, auto-restart)
- [x] Webhook dispatcher (HMAC-SHA256, exponential backoff)
- [x] OpenAPI 3.1 spec generation
- [x] CLI: `street create`, `street dev`, `street build`, `street start`, `street test`
- [x] CLI: `street generate controller/service/repository`
- [x] CLI: `street migrate:create`, `street migrate:run`
- [x] Docker multi-stage build
- [x] GitHub Actions CI/CD with npm provenance publish

---

## How to influence the roadmap

- **Vote** on existing issues with 👍
- **Open a feature request** at [github.com/hassanmubiru/issues](https://github.com/hassanmubiru/issues)
- **Start a discussion** at [github.com/hassanmubiru/discussions](https://github.com/hassanmubiru/discussions)
- **Contribute** — see the [Contributing Guide](/contributing/)
