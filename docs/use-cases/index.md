---
layout:       default
title:        "What Can Be Built"
nav_order:    12
has_children: false
permalink:    /use-cases/
description:  "What can be built with Street Framework — web apps, mobile backends, APIs, microservices, real-time systems, gaming, fintech, banking, IoT, healthcare, education, media, enterprise, AI infrastructure, cybersecurity, and government systems."
---

# What Can Be Built With Street Framework

Street is a **general-purpose TypeScript backend framework** comparable in scope to Express, Fastify, NestJS, Spring Boot, ASP.NET Core, and Laravel — with a TypeScript-first, memory-conscious, and security-focused design that makes it suitable for production workloads across every industry vertical.

This page shows what you can build, how Street's architecture maps to each domain, and which framework features carry the most weight in each context.

---

## Framework at a glance

Before diving into use cases, here is the full capability surface Street brings to every project:

| Capability | What it provides |
|---|---|
| **HTTP server** | Native `node:http`, compiled-regex router, middleware pipeline, request timeout |
| **Dependency injection** | IoC container, constructor injection, singleton registry, circular dep detection |
| **PostgreSQL** | Wire protocol v3, SCRAM-SHA-256, connection pool, streaming rows, migrations |
| **JWT** | HMAC-SHA256, `timingSafeEqual`, `alg`/`typ` enforcement, `exp`/`nbf`/`iat` |
| **Sessions** | AES-256-GCM, random 96-bit IV, auth tag validation, entropy-checked keys |
| **Rate limiting** | Sliding-window, BigInt nanosecond precision, 100K IP cap, per-key bounds |
| **WebSockets** | Bounded connection pool, heartbeat, typed event emitter, 512 KB payload cap |
| **SSE** | Keep-alive, heartbeat, CR/LF-safe field serialization, backpressure |
| **Multipart** | Streaming to disk, per-field 64 KB cap, listener cleanup |
| **Webhooks** | HMAC-SHA256 signatures, SSRF blocklist, DNS rebinding protection, retry |
| **Clustering** | `node:cluster` coordinator, IPC heartbeat, auto-restart, graceful shutdown |
| **Telemetry** | Heap profiling, P50/P99 latency, bounded ring buffer, health endpoint |
| **LRU cache** | TTL, O(1) eviction, periodic sweep, destroy on shutdown |
| **XSS sanitizer** | Recursive deep sanitization, depth/key/array bounds, null-byte stripping |
| **Security headers** | CSP, HSTS, COOP, CORP, X-Frame-Options, Referrer-Policy |
| **CORS** | Origin allowlist, `Vary: Origin`, preflight handling |
| **CSRF** | Timing-safe token comparison, session-backed, safe-method exemption |
| **Vault** | scrypt KEK derivation (N=131072), AES-256-GCM secret encryption at rest |
| **OpenAPI 3.1** | Auto-generated from `@ApiOperation` decorators |
| **CLI** | `street create`, `street dev`, `street generate`, `street migrate:create` |

---

## 1. Web Applications

### Description

Traditional and modern web applications — from server-rendered dashboards to single-page app backends — need a reliable HTTP layer, session management, file handling, and database access. Street handles all of these natively without reaching for third-party middleware.

### Typical architecture

```
Browser / SPA
    │
    ▼
Street HTTP Server
    ├── securityHeaders + corsMiddleware + csrfMiddleware
    ├── SessionManager (AES-256-GCM cookies)
    ├── RateLimiter (per-IP sliding window)
    ├── Router → Controllers → Services
    ├── MultipartParser (file uploads → disk)
    ├── PgPool → PostgreSQL
    └── SseConnection (live notifications)
```

### Street features used

- `streetApp` + `Router` — HTTP server and routing
- `SessionManager` — encrypted cookie sessions
- `csrfMiddleware` — CSRF protection for form submissions
- `MultipartParser` — streaming file uploads
- `SseConnection` — live feed updates without WebSocket overhead
- `PgPool` + `StreetPostgresRepository` — data persistence
- `securityHeaders` — CSP, HSTS, X-Frame-Options

### Benefits

- Zero-dependency session encryption — no `express-session`, no Redis required for basic use
- Streaming file uploads never spike heap regardless of file size
- CSRF protection is built in, not bolted on
- OpenAPI spec auto-generated for any API surface exposed to the frontend

### Example project ideas

| Project | Key Street features |
|---|---|
| Admin dashboard backend | Sessions, RBAC with `requireRoles`, PostgreSQL, SSE for live stats |
| E-commerce storefront API | JWT auth, file uploads (product images), rate limiting, OpenAPI |
| Blog / CMS backend | Multipart uploads, PostgreSQL full-text search, SSE for draft previews |
| Portfolio / personal site API | Lightweight HTTP server, PostgreSQL, OpenAPI |
| Survey / form platform | CSRF middleware, validation decorators, PostgreSQL, file attachments |

---

## 2. Mobile Backends

### Description

Mobile apps (iOS, Android, React Native, Flutter) need a stateless JSON API with fast authentication, push-notification triggers, file upload endpoints, and real-time data sync. Street's JWT-first design and WebSocket support make it a natural fit.

### Typical architecture

```
Mobile Client
    │  (HTTPS + Bearer JWT)
    ▼
Street HTTP Server
    ├── authMiddleware (JWT verification)
    ├── requireRoles (RBAC)
    ├── RateLimiter (per-device IP)
    ├── Router → Controllers
    ├── MultipartParser (avatar / media uploads)
    ├── StreetWebSocketServer (real-time sync)
    ├── WebhookDispatcher (push notification triggers)
    └── PgPool → PostgreSQL
```

### Street features used

- `JwtService` — stateless auth, no server-side session storage
- `authMiddleware` + `requireRoles` — per-route access control
- `MultipartParser` — profile photo and media uploads
- `StreetWebSocketServer` — real-time data sync (chat, notifications, live scores)
- `WebhookDispatcher` — trigger push notification services (FCM, APNs) via outbound webhooks
- `RateLimiter` — protect against credential stuffing and API abuse

### Benefits

- Stateless JWT means horizontal scaling with no shared session store
- WebSocket heartbeat automatically cleans up stale mobile connections
- SSRF-safe webhook dispatcher prevents mobile-triggered server-side request forgery
- Streaming uploads handle large media files without OOM risk

### Example project ideas

| Project | Key Street features |
|---|---|
| Social media app backend | JWT, WebSocket (feed updates), multipart (photo upload), PostgreSQL |
| Fitness tracker API | JWT, PostgreSQL (time-series workouts), SSE (live workout feed) |
| Food delivery app backend | WebSocket (order tracking), rate limiting, PostgreSQL, webhooks |
| Ride-sharing backend | WebSocket (driver location), JWT, PostgreSQL, clustering |
| Mobile banking app API | JWT, AES-256-GCM sessions, rate limiting, vault, PostgreSQL |

---

## 3. REST APIs & GraphQL Gateways

### Description

Street is purpose-built for API development. Its decorator-based routing, built-in validation, automatic OpenAPI generation, and parameterized query layer eliminate the boilerplate that dominates API projects in other frameworks.

### Typical architecture

```
API Consumers (web, mobile, third-party)
    │
    ▼
Street HTTP Server
    ├── corsMiddleware (origin allowlist)
    ├── authMiddleware (JWT)
    ├── RateLimiter
    ├── @Controller → @Get / @Post / @Put / @Delete
    ├── @Validate (request schema enforcement)
    ├── Services → PgPool
    └── /openapi.json (auto-generated spec)
```

### Street features used

- `@Controller`, `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch` — declarative routing
- `@Validate` — request body/query/params validation without Zod or Joi
- `@ApiOperation` — OpenAPI 3.1 spec generation
- `JwtService` + `authMiddleware` — Bearer token auth
- `PgPool` + `StreetPostgresRepository` — typed data access
- `corsMiddleware` — cross-origin access control

### Benefits

- OpenAPI spec is always in sync with the code — no separate schema maintenance
- `@Validate` catches malformed requests before they reach business logic
- Parameterized queries throughout — SQL injection is structurally prevented
- No framework overhead from unused features (no ORM, no template engine)

### Example project ideas

| Project | Key Street features |
|---|---|
| Public REST API (SaaS product) | OpenAPI, JWT, rate limiting, CORS, PostgreSQL |
| Internal microservice API | DI container, PostgreSQL, health endpoint, clustering |
| GraphQL gateway (schema stitching) | HTTP server as transport layer, JWT, PostgreSQL for resolvers |
| Webhook receiver API | HMAC signature verification, PostgreSQL event log, rate limiting |
| API versioning layer | Router with `/v1/`, `/v2/` prefixes, OpenAPI per version |

---

## 4. Microservices

### Description

Microservice architectures decompose a system into small, independently deployable services. Street's minimal footprint, fast startup, DI container, and clustering support make each service lean and self-contained. Its native PostgreSQL driver means no shared ORM layer between services.

### Typical architecture

```
API Gateway / Load Balancer
    │
    ├── Street Service A (users)      ─── PostgreSQL DB A
    ├── Street Service B (orders)     ─── PostgreSQL DB B
    ├── Street Service C (inventory)  ─── PostgreSQL DB C
    └── Street Service D (notifications) ─── WebhookDispatcher
              │
              └── Inter-service: HTTP webhooks (HMAC-signed)
```

### Street features used

- `streetApp` — lightweight per-service HTTP server
- `ClusterCoordinator` — multi-core utilization per service
- `WebhookDispatcher` — HMAC-signed inter-service event delivery
- `PgPool` — isolated database per service (database-per-service pattern)
- `TelemetryTracker` — per-service health and latency metrics
- `StreetMigrationRunner` — independent schema migrations per service
- `JwtService` — service-to-service JWT authentication

### Benefits

- Sub-100ms cold start — no framework initialization overhead
- Each service owns its schema and migrates independently
- HMAC-signed webhooks provide tamper-proof inter-service messaging
- Telemetry endpoint (`/health`, `/metrics`) ready out of the box for orchestrators

### Example project ideas

| Project | Key Street features |
|---|---|
| User service | JWT, PostgreSQL, migrations, health endpoint |
| Order processing service | PostgreSQL transactions, webhooks (payment triggers), clustering |
| Notification service | WebhookDispatcher (outbound), SSE (inbound push to clients) |
| File storage service | MultipartParser, streaming to object storage, PostgreSQL metadata |
| Auth service | JWT signing/verification, scrypt password hashing, vault, rate limiting |

```typescript
// Minimal microservice — ~30 lines
import { streetApp, PgPool, TelemetryTracker,
         securityHeaders, RateLimiter } from 'streetjs';

const pool = new PgPool({ host: process.env['PG_HOST']!, /* ... */ });
const telemetry = new TelemetryTracker();
const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 500 });

const app = streetApp({ port: 3000 });
app.use(securityHeaders);
app.use(limiter.middleware());
app.registerController(OrderController);

await pool.initialize();
await app.listen();
```

---

## 5. Real-Time Systems

### Description

Real-time systems — live dashboards, collaborative tools, notification hubs, live sports scores, trading tickers — require persistent connections, low-latency message delivery, and robust connection lifecycle management. Street provides both WebSocket and SSE transports with built-in heartbeat and bounded connection pools.

### Typical architecture

```
Clients
    │  WebSocket (bidirectional)   │  SSE (server-push)
    ▼                              ▼
StreetWebSocketServer          SseConnection
    ├── authFn (JWT on upgrade)    ├── heartbeat timer
    ├── heartbeat (ping/pong)      ├── CR/LF-safe serialization
    ├── maxConnections cap         └── cleanup on disconnect
    ├── broadcast()
    └── StreetSocket (typed events)
              │
              ▼
         PgPool → PostgreSQL (event source)
         TelemetryTracker (connection metrics)
```

### Street features used

- `StreetWebSocketServer` — bounded WebSocket server with heartbeat
- `WsServerOptions.authFn` — JWT authentication before upgrade
- `StreetSocket.on/emit` — typed event pub/sub per connection
- `broadcast()` — fan-out to all connected clients
- `SseConnection` — unidirectional server push (dashboards, feeds)
- `RateLimiter` — prevent WebSocket flood attacks
- `PgPool` — stream database change events to clients

### Benefits

- `authFn` hook prevents unauthenticated WebSocket upgrades at the protocol level
- Heartbeat automatically terminates stale connections — no zombie accumulation
- `maxConnections` cap with 1013 rejection prevents connection exhaustion
- 512 KB max payload cap prevents memory spikes from oversized frames
- SSE is zero-dependency — no `ws` library needed for one-way push

### Example project ideas

| Project | Key Street features |
|---|---|
| Live sports scores platform | WebSocket broadcast, PostgreSQL, SSE for score tickers |
| Collaborative document editor | WebSocket (operational transforms), JWT auth, PostgreSQL |
| Real-time analytics dashboard | SSE (metric stream), TelemetryTracker, PostgreSQL |
| Live auction platform | WebSocket (bid events), rate limiting, PostgreSQL transactions |
| Chat application | WebSocket rooms, JWT, PostgreSQL message history, file uploads |
| Stock price ticker | SSE, PostgreSQL, rate limiting, clustering |

---

## 6. Gaming Backends

### Description

Game backends handle player authentication, matchmaking, leaderboards, inventory, in-game purchases, and real-time game state synchronization. They demand low latency, high concurrency, and strict rate limiting to prevent cheating and abuse.

### Typical architecture

```
Game Clients (web, mobile, desktop)
    │
    ▼
Street HTTP Server (REST API)
    ├── JWT auth (player sessions)
    ├── RateLimiter (anti-cheat, anti-abuse)
    ├── PgPool → PostgreSQL (player data, leaderboards)
    └── LruCache (hot leaderboard data)

Street WebSocket Server (game state)
    ├── authFn (JWT on upgrade)
    ├── StreetSocket (per-player event stream)
    ├── broadcast (game events to room)
    └── heartbeat (detect disconnected players)

WebhookDispatcher
    └── Payment provider webhooks (in-game purchases)
```

### Street features used

- `JwtService` — player session tokens with short expiry
- `StreetWebSocketServer` + `authFn` — authenticated real-time game state
- `RateLimiter` — per-player action rate limiting (anti-cheat)
- `LruCache` — hot leaderboard caching with TTL
- `PgPool` — player profiles, inventory, match history
- `WebhookDispatcher` — receive payment confirmations from Stripe/PayPal
- `ClusterCoordinator` — multi-core game server

### Benefits

- Per-player rate limiting prevents action flooding and bot abuse
- LRU cache with TTL keeps leaderboard reads fast without a separate Redis instance
- WebSocket `authFn` ensures only authenticated players connect to game rooms
- Clustering maximizes CPU utilization for compute-intensive game logic

### Example project ideas

| Project | Key Street features |
|---|---|
| Multiplayer game server | WebSocket, JWT, rate limiting, clustering, PostgreSQL |
| Leaderboard service | LRU cache, PostgreSQL, REST API, OpenAPI |
| Player inventory system | PostgreSQL, JWT, parameterized queries, migrations |
| Matchmaking service | WebSocket, PostgreSQL, rate limiting, health endpoint |
| In-game store backend | JWT, webhooks (payment), PostgreSQL transactions, vault |
| Game analytics pipeline | SSE, TelemetryTracker, PostgreSQL, streaming queries |

---

## 7. Fintech Platforms

### Description

Fintech platforms — payment processors, lending platforms, investment apps, crypto exchanges — operate under strict regulatory requirements and face adversarial traffic. They need ACID transactions, cryptographic audit trails, tamper-proof webhooks, and defense-in-depth security at every layer.

### Typical architecture

```
Client Apps / Partner APIs
    │  (mTLS or JWT)
    ▼
Street HTTP Server
    ├── securityHeaders + HSTS
    ├── authMiddleware (JWT, short expiry)
    ├── requireRoles (RBAC: user / analyst / admin)
    ├── RateLimiter (per-IP + per-user)
    ├── csrfMiddleware
    ├── xssMiddleware
    ├── Router → Controllers → Services
    │       └── PgPool.transaction() (ACID)
    ├── WebhookDispatcher (payment events, HMAC-signed)
    └── Vault (KEK-encrypted secrets at rest)
```

### Street features used

- `PgPool.transaction()` — ACID guarantees for fund transfers and ledger entries
- `LedgerTransactionService` — multi-operation atomic transactions
- `JwtService` — short-lived access tokens (15 min), long-lived refresh tokens
- `SessionManager` (AES-256-GCM) — encrypted server-side session state
- `Vault` (scrypt + AES-256-GCM) — API keys and secrets encrypted at rest
- `WebhookDispatcher` — HMAC-SHA256 signed outbound payment events
- `RateLimiter` — brute-force and credential-stuffing protection
- `csrfMiddleware` — CSRF protection for web-based payment flows
- `constantTimeEqual` — timing-safe secret comparison

### Benefits

- `PgPool.transaction()` with automatic `ROLLBACK` on error prevents partial fund transfers
- Vault mode means database credentials and API keys are never stored in plaintext
- HMAC-signed webhooks give payment partners a tamper-proof event stream
- `timingSafeEqual` throughout prevents timing oracle attacks on token comparison
- scrypt N=131072 makes offline KEK brute-force computationally expensive

### Example project ideas

| Project | Key Street features |
|---|---|
| Payment processing API | PostgreSQL transactions, vault, JWT, webhooks, rate limiting |
| Peer-to-peer lending platform | ACID transactions, JWT, RBAC, PostgreSQL, audit log |
| Crypto exchange backend | WebSocket (order book), PostgreSQL, rate limiting, clustering |
| Personal finance tracker | JWT, PostgreSQL, OpenAPI, SSE (budget alerts) |
| Invoice and billing system | PostgreSQL, webhooks (payment confirmation), JWT, OpenAPI |
| KYC / AML compliance service | Vault (PII encryption), PostgreSQL, rate limiting, audit trail |

```typescript
// ACID fund transfer — never leaves partial state
await pool.transaction(async (conn) => {
  await conn.query(
    'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1',
    [amount, fromAccountId]
  );
  await conn.query(
    'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
    [amount, toAccountId]
  );
  await conn.query(
    'INSERT INTO ledger (from_id, to_id, amount, ts) VALUES ($1, $2, $3, NOW())',
    [fromAccountId, toAccountId, amount]
  );
});
```

---

## 8. Banking Systems

### Description

Core banking systems require the highest levels of data integrity, auditability, regulatory compliance, and security. They handle account management, transaction processing, loan origination, and regulatory reporting — all with strict SLA requirements and zero tolerance for data loss.

### Typical architecture

```
Internal Banking Applications
    │  (mTLS + JWT, internal network only)
    ▼
Street HTTP Server (internal API)
    ├── securityHeaders (HSTS, CSP, COOP)
    ├── authMiddleware (JWT, role-based)
    ├── requireRoles (teller / manager / auditor / admin)
    ├── RateLimiter (per-employee, per-branch)
    ├── csrfMiddleware
    ├── Router → Controllers → Services
    │       └── PgPool.transaction() (ACID, serializable isolation)
    ├── StreetMigrationRunner (schema versioning)
    ├── Vault (KEK-encrypted PII and credentials)
    └── TelemetryTracker (SLA monitoring)

ClusterCoordinator
    └── Multi-core primary + workers (zero-downtime rolling restart)
```

### Street features used

- `PgPool.transaction()` — serializable ACID transactions for account operations
- `StreetMigrationRunner` — versioned, auditable schema changes
- `Vault` — AES-256-GCM encryption of PII (SSNs, account numbers) at rest
- `JwtService` — employee authentication with role claims
- `requireRoles` — four-eyes principle enforcement (teller vs. manager approval)
- `TelemetryTracker` — P99 latency monitoring for SLA compliance
- `ClusterCoordinator` — high availability with automatic worker restart
- `securityHeaders` — CSP, HSTS, COOP, CORP for internal web interfaces

### Benefits

- Schema migrations are versioned, idempotent, and tracked in `street_migrations` table
- Vault mode keeps PII encrypted at rest — KEK never touches the database
- Clustering with IPC heartbeat provides automatic recovery from worker crashes
- Telemetry ring buffer gives 24 hours of latency history for SLA reporting
- All SQL uses parameterized queries — SQL injection is structurally impossible

### Example project ideas

| Project | Key Street features |
|---|---|
| Core banking API | ACID transactions, vault (PII), RBAC, migrations, clustering |
| Account management service | PostgreSQL, JWT, RBAC, OpenAPI, health endpoint |
| Loan origination system | ACID transactions, vault, RBAC, PostgreSQL, audit log |
| Regulatory reporting API | PostgreSQL streaming queries, JWT, rate limiting |
| Branch teller application backend | JWT, RBAC, CSRF, sessions, PostgreSQL |
| Fraud detection service | Rate limiting, PostgreSQL, SSE (real-time alerts), telemetry |

---

## 9. IoT Platforms

### Description

IoT platforms ingest telemetry from thousands or millions of devices, store time-series data, trigger automations, and push configuration updates back to devices. They need high-throughput ingestion, efficient connection management, and reliable outbound messaging.

### Typical architecture

```
IoT Devices (sensors, actuators, gateways)
    │  (HTTPS REST or WebSocket)
    ▼
Street HTTP Server (ingestion API)
    ├── authMiddleware (device JWT or API key)
    ├── RateLimiter (per-device-ID)
    ├── Router → TelemetryController
    │       └── PgPool (time-series insert)
    └── WebhookDispatcher (automation triggers)

Street WebSocket Server (device command channel)
    ├── authFn (device certificate / JWT)
    ├── StreetSocket (per-device bidirectional channel)
    └── broadcast (fleet-wide config push)

SseConnection
    └── Dashboard clients (live device feed)
```

### Street features used

- `RateLimiter` — per-device rate limiting (prevent rogue device flooding)
- `StreetWebSocketServer` + `authFn` — authenticated persistent device connections
- `broadcast()` — push firmware updates or config changes to entire device fleet
- `SseConnection` — stream live telemetry to monitoring dashboards
- `PgPool` — high-throughput time-series inserts with connection pooling
- `WebhookDispatcher` — trigger automations (IFTTT-style rules) on threshold events
- `TelemetryTracker` — platform health monitoring
- `ClusterCoordinator` — scale ingestion across CPU cores

### Benefits

- WebSocket `maxConnections` cap prevents a device storm from exhausting server resources
- Per-device rate limiting isolates misbehaving devices without affecting the fleet
- Streaming PostgreSQL queries let dashboards consume large time-series datasets without OOM
- Webhook SSRF protection prevents device-triggered requests to internal infrastructure

### Example project ideas

| Project | Key Street features |
|---|---|
| Smart home hub backend | WebSocket (device commands), PostgreSQL, SSE (dashboard), webhooks |
| Industrial sensor platform | High-throughput REST ingestion, PostgreSQL, rate limiting, clustering |
| Fleet management system | WebSocket (GPS stream), PostgreSQL, SSE (live map), JWT |
| Agricultural monitoring | REST ingestion, PostgreSQL time-series, SSE (alerts), webhooks |
| Smart city infrastructure | Clustering, PostgreSQL, WebSocket, rate limiting, telemetry |
| Energy management platform | PostgreSQL, SSE (live consumption), webhooks (threshold alerts) |

---

## 10. Healthcare Systems

### Description

Healthcare systems handle protected health information (PHI) under regulations like HIPAA, GDPR, and HL7 FHIR. They require end-to-end encryption, strict access control, comprehensive audit logging, and zero-downtime deployments. Street's vault mode, RBAC, and ACID transactions address these requirements directly.

### Typical architecture

```
Clinical Applications / Patient Portal
    │  (HTTPS + JWT)
    ▼
Street HTTP Server
    ├── securityHeaders (HSTS, CSP, COOP)
    ├── authMiddleware (JWT, short expiry)
    ├── requireRoles (patient / nurse / doctor / admin)
    ├── csrfMiddleware
    ├── xssMiddleware
    ├── Router → Controllers → Services
    │       └── PgPool.transaction() (ACID)
    ├── Vault (PHI encryption at rest)
    ├── StreetMigrationRunner (auditable schema changes)
    └── WebhookDispatcher (HL7 FHIR event notifications)
```

### Street features used

- `Vault` — AES-256-GCM encryption of PHI (diagnoses, prescriptions, lab results)
- `requireRoles` — role-based access (patient can only see their own records)
- `PgPool.transaction()` — atomic writes for clinical records
- `StreetMigrationRunner` — versioned, auditable schema evolution
- `JwtService` — short-lived tokens (15 min) for clinical workstations
- `SessionManager` — encrypted sessions for patient portal
- `WebhookDispatcher` — HL7 FHIR R4 event notifications to EHR systems
- `csrfMiddleware` — CSRF protection for patient-facing web forms
- `TelemetryTracker` — uptime and latency monitoring for SLA compliance

### Benefits

- Vault mode keeps PHI encrypted at rest — the database never stores plaintext diagnoses
- RBAC with `requireRoles` enforces minimum necessary access (HIPAA principle)
- ACID transactions prevent partial writes to clinical records
- Audit trail via PostgreSQL — every data change is traceable
- HMAC-signed webhooks provide tamper-proof HL7 event delivery to partner systems

### Example project ideas

| Project | Key Street features |
|---|---|
| Electronic health record (EHR) API | Vault (PHI), RBAC, ACID transactions, migrations, audit log |
| Patient portal backend | JWT, sessions, CSRF, PostgreSQL, SSE (appointment reminders) |
| Telemedicine platform | WebSocket (video signaling), JWT, PostgreSQL, rate limiting |
| Lab results service | Vault, JWT, RBAC, PostgreSQL, webhooks (HL7 notifications) |
| Appointment scheduling system | PostgreSQL, JWT, SSE (real-time availability), CSRF |
| Medical device data ingestion | REST API, rate limiting, PostgreSQL, clustering |

---

## 11. Education Platforms

### Description

Education platforms — LMS systems, online course platforms, coding bootcamps, assessment tools — serve diverse user populations (students, instructors, administrators) with different access levels, real-time collaboration needs, and large media assets.

### Typical architecture

```
Students / Instructors / Admins
    │
    ▼
Street HTTP Server
    ├── authMiddleware (JWT)
    ├── requireRoles (student / instructor / admin)
    ├── RateLimiter (quiz submission rate limiting)
    ├── MultipartParser (assignment uploads, video)
    ├── Router → Controllers → Services
    │       └── PgPool → PostgreSQL
    ├── StreetWebSocketServer (live classroom)
    ├── SseConnection (progress notifications)
    └── WebhookDispatcher (grade webhooks to SIS)
```

### Street features used

- `requireRoles` — students see their own grades; instructors see their cohort
- `MultipartParser` — assignment and video uploads streamed to disk
- `StreetWebSocketServer` — live classroom sessions, collaborative coding
- `SseConnection` — real-time progress updates and notifications
- `RateLimiter` — prevent quiz answer flooding and brute-force
- `WebhookDispatcher` — push grade events to Student Information Systems
- `PgPool` — course content, enrollments, grades, progress tracking
- `LruCache` — cache hot course content (syllabus, video metadata)

### Benefits

- Streaming file uploads handle large video assignments without heap pressure
- WebSocket rooms enable live classroom features without a separate socket server
- LRU cache reduces database load for frequently accessed course content
- Rate limiting on quiz endpoints prevents automated answer submission

### Example project ideas

| Project | Key Street features |
|---|---|
| LMS backend (Moodle alternative) | JWT, RBAC, PostgreSQL, file uploads, SSE, webhooks |
| Online coding platform | WebSocket (live code execution), JWT, PostgreSQL, rate limiting |
| Video course platform | Multipart uploads, PostgreSQL, LRU cache, JWT, SSE |
| Assessment and quiz engine | Rate limiting, PostgreSQL, JWT, RBAC, CSRF |
| Student progress tracker | PostgreSQL, SSE (live progress), JWT, OpenAPI |
| Virtual classroom | WebSocket, JWT, PostgreSQL, clustering |

---

## 12. Media Platforms

### Description

Media platforms — video streaming services, podcast hosts, image galleries, news aggregators, live streaming backends — handle large binary assets, high read throughput, real-time viewer counts, and content delivery pipelines. Street's streaming multipart parser and WebSocket broadcast are central here.

### Typical architecture

```
Content Creators / Viewers
    │
    ▼
Street HTTP Server
    ├── authMiddleware (JWT)
    ├── RateLimiter (upload rate, API calls)
    ├── MultipartParser (video / audio / image upload → object storage)
    ├── Router → Controllers → Services
    │       └── PgPool → PostgreSQL (metadata, comments, likes)
    ├── StreetWebSocketServer (live viewer count, live chat)
    ├── SseConnection (notification feed)
    ├── LruCache (hot content metadata)
    └── WebhookDispatcher (CDN purge, transcoding triggers)
```

### Street features used

- `MultipartParser` — stream large video/audio files to disk or object storage
- `StreetWebSocketServer` — live viewer counts, live chat, real-time reactions
- `SseConnection` — notification feed (new episode, comment reply)
- `LruCache` — cache hot content metadata (title, thumbnail URL, view count)
- `WebhookDispatcher` — trigger CDN cache purge and transcoding jobs
- `RateLimiter` — upload rate limiting per creator account
- `PgPool` — content metadata, user subscriptions, comment threads

### Benefits

- Streaming multipart parser handles multi-GB video uploads with constant heap usage
- LRU cache with TTL keeps popular content metadata fast without Redis
- WebSocket broadcast delivers live viewer counts to thousands of concurrent viewers
- HMAC-signed webhooks give CDN and transcoding services tamper-proof event delivery

### Example project ideas

| Project | Key Street features |
|---|---|
| Video hosting platform | Multipart uploads, PostgreSQL, LRU cache, webhooks (transcoding) |
| Podcast hosting backend | Multipart uploads, PostgreSQL, SSE (new episode alerts), JWT |
| Live streaming platform | WebSocket (live chat, viewer count), JWT, PostgreSQL, clustering |
| Photo sharing platform | Multipart uploads, PostgreSQL, LRU cache, JWT, rate limiting |
| News aggregator API | PostgreSQL, LRU cache, SSE (breaking news), OpenAPI |
| Music streaming backend | PostgreSQL, JWT, LRU cache, rate limiting, SSE |

---

## 13. Enterprise Software

### Description

Enterprise software — ERP systems, CRM platforms, HR management, supply chain tools — serves large internal user bases with complex permission hierarchies, integration requirements, and strict audit trails. Street's DI container, RBAC, and ACID transactions map directly to enterprise patterns.

### Typical architecture

```
Enterprise Users (web, desktop clients)
    │  (SSO JWT or SAML-to-JWT bridge)
    ▼
Street HTTP Server
    ├── securityHeaders
    ├── authMiddleware (JWT from SSO)
    ├── requireRoles (employee / manager / director / admin)
    ├── csrfMiddleware
    ├── Router → Controllers → Services (DI container)
    │       └── PgPool.transaction() (ACID)
    ├── StreetMigrationRunner (schema versioning)
    ├── Vault (sensitive config at rest)
    ├── TelemetryTracker (SLA monitoring)
    └── WebhookDispatcher (ERP integration events)
```

### Street features used

- `Container` (DI) — clean separation of controllers, services, repositories
- `requireRoles` — hierarchical RBAC (employee → manager → director → admin)
- `PgPool.transaction()` — atomic multi-table writes (order + inventory + ledger)
- `StreetMigrationRunner` — zero-downtime schema evolution with rollback support
- `Vault` — encrypted database credentials and integration API keys
- `WebhookDispatcher` — push events to ERP, CRM, and HR systems
- `TelemetryTracker` — P50/P99 latency for SLA dashboards
- `ClusterCoordinator` — high availability for business-critical services

### Benefits

- DI container makes large codebases testable and maintainable
- Migration runner with rollback support enables safe schema changes in production
- Vault mode keeps integration credentials out of source control and environment files
- Telemetry endpoint provides SLA data without a separate APM agent

### Example project ideas

| Project | Key Street features |
|---|---|
| ERP backend | ACID transactions, RBAC, DI container, migrations, vault, telemetry |
| CRM platform | PostgreSQL, JWT, RBAC, OpenAPI, webhooks (Salesforce sync) |
| HR management system | Vault (PII), RBAC, PostgreSQL, CSRF, migrations |
| Supply chain management | ACID transactions, PostgreSQL, webhooks, clustering |
| Project management tool | PostgreSQL, JWT, WebSocket (live updates), SSE, RBAC |
| Document management system | Multipart uploads, PostgreSQL, JWT, RBAC, LRU cache |

---

## 14. AI Infrastructure

### Description

AI infrastructure backends — model serving APIs, training job orchestrators, vector database proxies, RAG pipelines, AI agent frameworks — need high-throughput request handling, streaming response delivery, and reliable job queuing. Street's SSE streaming and PostgreSQL integration make it a strong foundation for AI-adjacent services.

### Typical architecture

```
AI Clients (web apps, agents, notebooks)
    │
    ▼
Street HTTP Server
    ├── authMiddleware (JWT or API key)
    ├── RateLimiter (per-user token budget)
    ├── Router → InferenceController
    │       ├── SseConnection (streaming token output)
    │       ├── PgPool (conversation history, embeddings)
    │       └── WebhookDispatcher (async job completion)
    ├── MultipartParser (document / image upload for RAG)
    └── LruCache (embedding cache, prompt cache)
```

### Street features used

- `SseConnection` — stream LLM token output to clients (ChatGPT-style streaming)
- `RateLimiter` — per-user token rate limiting (requests per minute / tokens per day)
- `MultipartParser` — document and image uploads for RAG pipelines
- `LruCache` — cache embeddings and prompt completions with TTL
- `PgPool` — store conversation history, embeddings (pgvector), job queue
- `WebhookDispatcher` — notify clients when async inference jobs complete
- `JwtService` — API key authentication (sign a JWT per API key)
- `ClusterCoordinator` — multi-core inference request handling

### Benefits

- SSE streaming delivers token-by-token output with zero additional dependencies
- Rate limiting enforces per-user token budgets without a separate quota service
- LRU cache with TTL reduces redundant embedding computations
- PostgreSQL with pgvector extension stores and queries embeddings natively

### Example project ideas

| Project | Key Street features |
|---|---|
| LLM inference API | SSE (token streaming), JWT, rate limiting, PostgreSQL (history) |
| RAG pipeline backend | Multipart (doc upload), PostgreSQL (pgvector), LRU cache, JWT |
| AI agent orchestrator | WebSocket (agent events), PostgreSQL (state), webhooks, clustering |
| Embedding service | REST API, LRU cache, PostgreSQL, rate limiting, OpenAPI |
| AI-powered search backend | PostgreSQL (pgvector), JWT, rate limiting, SSE (streaming results) |
| Model fine-tuning job API | Multipart (dataset upload), PostgreSQL (job queue), webhooks |

```typescript
// Streaming LLM response via SSE
@Get('/chat/stream')
async streamChat(ctx: StreetContext): Promise<void> {
  const sse = createSse(ctx.res);
  const prompt = ctx.query['q'] ?? '';

  // Stream tokens from your inference engine
  for await (const token of inferenceEngine.stream(prompt)) {
    sse.send({ event: 'token', data: { text: token } });
  }

  sse.send({ event: 'done', data: { finish_reason: 'stop' } });
  sse.close();
}
```

---

## 15. Cybersecurity Platforms

### Description

Cybersecurity platforms — SIEM systems, vulnerability scanners, threat intelligence feeds, SOC dashboards, penetration testing tools, and security automation platforms — need high-throughput event ingestion, real-time alerting, tamper-proof audit logs, and strict access control. Street's security-first design makes it uniquely suited here.

### Typical architecture

```
Security Agents / Sensors / SIEM Integrations
    │  (HTTPS + HMAC-signed payloads)
    ▼
Street HTTP Server (event ingestion)
    ├── authMiddleware (JWT, short expiry)
    ├── requireRoles (analyst / engineer / admin)
    ├── RateLimiter (per-agent, per-source)
    ├── Router → EventController
    │       └── PgPool (event store, IOC database)
    ├── StreetWebSocketServer (SOC live feed)
    ├── SseConnection (alert stream to dashboard)
    ├── WebhookDispatcher (SIEM / ticketing integrations)
    └── Vault (API keys for threat intel feeds)
```

### Street features used

- `JwtService` — short-lived analyst tokens (15 min) with role claims
- `requireRoles` — analyst / engineer / admin separation of duties
- `RateLimiter` — per-agent ingestion rate limiting
- `StreetWebSocketServer` — real-time SOC alert feed
- `SseConnection` — live threat dashboard without polling
- `WebhookDispatcher` — push alerts to PagerDuty, Jira, Slack (HMAC-signed)
- `Vault` — encrypted threat intelligence API keys at rest
- `PgPool.transaction()` — atomic event correlation writes
- `constantTimeEqual` — timing-safe API key comparison
- `securityHeaders` — hardened headers for SOC web interface

### Benefits

- `constantTimeEqual` prevents timing oracle attacks on API key validation
- Vault mode keeps threat intel API keys encrypted — a compromised database reveals nothing
- HMAC-signed webhooks give SIEM integrations tamper-proof event delivery
- Rate limiting per agent prevents a compromised sensor from flooding the event store
- Short-lived JWT tokens limit the blast radius of stolen analyst credentials

### Example project ideas

| Project | Key Street features |
|---|---|
| SIEM event ingestion API | Rate limiting, PostgreSQL, JWT, webhooks, clustering |
| SOC real-time dashboard | WebSocket, SSE, JWT, RBAC, PostgreSQL |
| Threat intelligence platform | Vault (API keys), PostgreSQL, JWT, LRU cache, OpenAPI |
| Vulnerability scanner backend | REST API, PostgreSQL, JWT, RBAC, webhooks (ticket creation) |
| Security automation platform | Webhooks, PostgreSQL, JWT, rate limiting, clustering |
| Incident response system | ACID transactions, RBAC, PostgreSQL, SSE (live timeline) |

---

## 16. Government Systems

### Description

Government systems — citizen portals, permit management, tax filing platforms, public records APIs, emergency services backends — operate under strict compliance frameworks (FedRAMP, FISMA, GDPR, WCAG) and require the highest levels of security, auditability, and availability.

### Typical architecture

```
Citizens / Government Staff
    │  (HTTPS + MFA-backed JWT)
    ▼
Street HTTP Server
    ├── securityHeaders (HSTS preload, CSP, COOP, CORP)
    ├── authMiddleware (JWT from identity provider)
    ├── requireRoles (citizen / clerk / supervisor / admin)
    ├── csrfMiddleware
    ├── xssMiddleware
    ├── RateLimiter (per-citizen, per-IP)
    ├── Router → Controllers → Services (DI)
    │       └── PgPool.transaction() (ACID)
    ├── StreetMigrationRunner (auditable schema changes)
    ├── Vault (PII encryption at rest)
    ├── MultipartParser (document submissions)
    ├── TelemetryTracker (uptime SLA monitoring)
    └── ClusterCoordinator (high availability)
```

### Street features used

- `Vault` — AES-256-GCM encryption of citizen PII (SSN, address, tax ID)
- `requireRoles` — strict separation between citizen self-service and staff access
- `csrfMiddleware` — CSRF protection for all government form submissions
- `xssMiddleware` — sanitize all citizen-submitted input
- `securityHeaders` — HSTS preload, CSP, COOP, CORP for FedRAMP compliance
- `StreetMigrationRunner` — versioned, auditable schema changes with rollback
- `PgPool.transaction()` — atomic permit approvals and record updates
- `MultipartParser` — citizen document uploads (ID, proof of address)
- `TelemetryTracker` — uptime and latency for SLA reporting
- `ClusterCoordinator` — zero-downtime rolling restarts

### Benefits

- Vault mode satisfies data-at-rest encryption requirements (FedRAMP, FISMA)
- CSRF + XSS middleware provides defense-in-depth for citizen-facing forms
- HSTS preload and CSP headers satisfy WCAG and security compliance checklists
- Migration runner with rollback enables safe schema changes without downtime
- Telemetry endpoint provides uptime data for SLA reporting without a separate APM

### Example project ideas

| Project | Key Street features |
|---|---|
| Citizen portal backend | Vault (PII), RBAC, CSRF, XSS, HSTS, PostgreSQL, multipart |
| Permit management system | ACID transactions, RBAC, migrations, PostgreSQL, file uploads |
| Tax filing platform | Vault (PII), CSRF, RBAC, PostgreSQL, rate limiting, clustering |
| Public records API | JWT, OpenAPI, PostgreSQL, rate limiting, CORS |
| Emergency services dispatch | WebSocket (real-time dispatch), PostgreSQL, clustering, telemetry |
| Benefits administration system | Vault, RBAC, ACID transactions, PostgreSQL, migrations, audit log |

---

## Framework comparison

Street is positioned as a **general-purpose production backend framework** comparable to the following:

| Framework | Language | Street advantage |
|---|---|---|
| **Express** | JavaScript | TypeScript-first, memory bounds, built-in security, native PostgreSQL |
| **Fastify** | JavaScript/TypeScript | Built-in auth, sessions, WebSocket, PostgreSQL — no plugin ecosystem needed |
| **NestJS** | TypeScript | Lighter DI, no class-validator/class-transformer dependency, native wire protocol |
| **Spring Boot** | Java | Same production-grade features, Node.js ecosystem, faster cold start |
| **ASP.NET Core** | C# | TypeScript-first, no runtime license, same security depth |
| **Laravel** | PHP | Statically typed, memory-safe, no ORM overhead, native async |
| **Django** | Python | Async-native, TypeScript types, no GIL, horizontal scaling via clustering |
| **Gin / Echo** | Go | Richer built-in feature set (auth, sessions, WebSocket, migrations) |

Street does not require you to assemble a security stack from separate packages. JWT, sessions, rate limiting, XSS sanitization, CSRF protection, security headers, CORS, vault encryption, and HMAC-signed webhooks are all included and integrated.

---

## Choosing Street for your project

Use Street when you need:

- **TypeScript throughout** — strict mode, `NodeNext` ESM, full type inference
- **Security by default** — every security primitive built in, not bolted on
- **Memory predictability** — explicit bounds on every collection, buffer, and connection
- **No dependency sprawl** — two runtime dependencies (`reflect-metadata`, `ws`)
- **Native PostgreSQL** — wire protocol v3, SCRAM-SHA-256, no `pg` package
- **Production-ready from day one** — clustering, telemetry, health endpoints, migrations

```bash
npm install -g @streetjs/cli
street create my-project
cd my-project && npm install && street dev
```

{: .note }
Street is MIT-licensed and runs on Node.js 20+. See the [Getting Started](/getting-started/installation/) guide to scaffold your first project in under 60 seconds.
