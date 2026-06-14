# StreetJS Content Backlog

A prioritized, StreetJS-specific content backlog for the discoverability and
community-growth track (Platform Leadership program, deliverable 6). Topics are
grounded in capabilities that exist in the repo today — no vaporware.

Legend for suggested funnel stage: **TOFU** (awareness), **MOFU** (evaluation),
**BOFU** (adoption/migration).

---

## 100 Blog Topics

### Getting started & positioning (TOFU)
1. What is StreetJS and why a backend framework with only 2 dependencies
2. StreetJS vs Express: what you gain by dropping the middleware stack
3. StreetJS vs NestJS: decorators without the module graph
4. StreetJS vs Fastify: speed plus a native PostgreSQL driver
5. Building your first REST API with StreetJS in 10 minutes
6. The case for building on Node.js core modules
7. Why StreetJS ships a native PostgreSQL wire driver instead of `pg`
8. Memory-safety as a framework feature, not an afterthought
9. TypeScript-first backend design: decorators, DI, and metadata
10. From `npx create-street-app` to production in one afternoon

### Routing, controllers & DI (MOFU)
11. Decorator-based routing in StreetJS explained
12. The StreetJS dependency-injection container in depth
13. Constructor injection patterns for testable services
14. Structuring a large StreetJS app without modules
15. Request lifecycle in StreetJS: from socket to `ctx.json`
16. Building reusable middleware in StreetJS
17. Versioning your API with StreetJS URL strategies
18. OpenAPI generation from StreetJS controllers
19. Error handling with typed exceptions (no stack-trace leaks)
20. Content negotiation and streaming responses

### Data & PostgreSQL (MOFU/BOFU)
21. The native PostgreSQL driver: wire protocol v3 from scratch
22. SCRAM-SHA-256 auth without a third-party client
23. Connection pooling and pool-exhaustion handling in StreetJS
24. Parameterized queries and SQL-injection safety by default
25. Migrations with StreetJS: create, run, and diff
26. Seeding data deterministically for tests and demos
27. Query profiling and slow-query diagnostics
28. The repository pattern in StreetJS
29. Read replicas and region-aware routing
30. SQLite (WASM) for local dev and edge
31. MySQL/MariaDB support and the no-cleartext auth policy
32. Backups with checksum-verified restore
33. Field-level encryption for PII at rest
34. Data classification and retention policies in code
35. Building an audit log that supports compliance reviews

### Realtime (MOFU)
36. WebSockets in StreetJS without external frameworks
37. Server-Sent Events for live dashboards
38. Designing a ChannelHub for presence and rooms
39. Building a realtime chat backend, end to end
40. Backpressure and bounded memory in realtime systems
41. Scaling WebSockets across a Node.js cluster
42. Authenticated WebSocket connections with JWT

### Security (MOFU/BOFU)
43. Security headers and CSP with StreetJS
44. CORS done right with `corsMiddleware`
45. JWT issuance and verification with `JwtService`
46. AES-256-GCM sessions explained
47. Rate limiting: in-memory and Redis-backed stores
48. Input validation that rejects before the handler runs
49. XSS sanitization helpers in StreetJS
50. Abuse prevention and IP reputation hooks
51. A content-moderation toolkit for user-generated content
52. Secret management adapters (GitHub, cloud providers)
53. mTLS and client-certificate validation
54. Threat modeling a StreetJS service
55. Hardening a StreetJS deployment: a checklist
56. Vault mode: keeping plaintext out of the database

### Jobs, messaging & microservices (MOFU)
57. Background jobs and the jobs dashboard
58. Cron-style scheduling in StreetJS
59. Kafka transport integration
60. RabbitMQ transport integration
61. Webhook dispatch with TLS validation
62. Subsystem metrics for Postgres, Kafka, and RabbitMQ
63. Building an HTTP/2 microservice
64. Idempotency keys for safe retries

### AI (MOFU)
65. Building an AI assistant backend with StreetJS
66. Streaming agent steps over SSE
67. A tool-calling agent executor pattern
68. Rate-limiting and cost controls for LLM endpoints

### Multi-tenancy & enterprise (BOFU)
69. Multi-tenant isolation models in StreetJS
70. The enterprise console and policy management
71. RBAC with `requireRoles` in practice
72. Building a SaaS billing backend with the commerce module
73. Mapping StreetJS controls to SOC 2 criteria
74. GDPR data-subject requests with retention APIs
75. HIPAA-aligned PHI handling patterns

### Testing & quality (MOFU)
76. Property-based testing with fast-check in StreetJS
77. Testing controllers without booting a server
78. Chaos testing with fault injection
79. Load testing a StreetJS service
80. Fuzzing the wire protocol
81. Memory-leak detection in CI
82. Contract testing official plugins

### Deployment & ops (BOFU)
83. Dockerizing a StreetJS app with a distroless image
84. Deploying StreetJS to Google Cloud Run
85. Deploying StreetJS to AWS ECS
86. Deploying StreetJS to Vercel
87. Deploying StreetJS to Cloudflare Workers (edge)
88. Health checks: liveness and readiness endpoints
89. Observability: Prometheus metrics and OpenTelemetry traces
90. Zero-downtime rollbacks for StreetJS releases
91. Reproducible releases with npm provenance and SBOMs

### Ecosystem & DX (TOFU/MOFU)
92. The StreetJS CLI: 21 commands tour
93. Scaffolding apps with `street create --template`
94. Codemods and automated upgrades with `street upgrade`
95. `street doctor`: diagnosing project issues
96. Publishing a signed plugin to the StreetJS registry
97. Writing your own official-quality plugin
98. The signed plugin registry and Ed25519 verification
99. Contributing to StreetJS: your first PR
100. The StreetJS LTS policy and release cadence

---

## 50 YouTube / Video Topics

1. StreetJS in 100 seconds
2. Build a REST API with StreetJS (live coding)
3. Native PostgreSQL driver demo — no `pg`
4. Realtime chat backend from scratch
5. Live dashboard with Server-Sent Events
6. Dependency injection without modules
7. Decorator routing walkthrough
8. JWT auth end to end
9. Rate limiting with Redis
10. Input validation that blocks bad requests
11. Migrations and seeding demo
12. Query profiling live
13. Multiplayer game backend with WebSockets
14. Deploying to Cloud Run in 5 minutes
15. Deploying to Cloudflare Workers (edge)
16. Dockerizing StreetJS (distroless)
17. Observability: Prometheus + Grafana setup
18. Background jobs and the dashboard
19. Kafka transport integration
20. RabbitMQ transport integration
21. AI assistant backend with streaming
22. Tool-calling agent executor demo
23. Multi-tenant SaaS skeleton
24. Commerce module: building checkout
25. Social feed backend walkthrough
26. Dating app backend architecture
27. Property-based testing crash course
28. Chaos testing your API
29. Load testing walkthrough
30. Memory-leak detection in CI
31. Migrating an Express app live
32. Migrating a NestJS app live
33. Migrating a Fastify app live
34. The StreetJS CLI tour
35. `street create` template gallery
36. `street doctor` and `street upgrade`
37. Publishing a signed plugin
38. Writing a custom plugin
39. Security headers and CSP setup
40. mTLS between services
41. Field-level encryption demo
42. Audit logging for compliance
43. Health checks and graceful shutdown
44. Zero-downtime rollback demo
45. npm provenance + SBOM explained
46. Reading the StreetJS source: the router
47. Reading the StreetJS source: the PG driver
48. Benchmarking StreetJS vs Express/Fastify
49. Contributing your first PR (screencast)
50. StreetJS release notes: what's new

---

## 25 Conference Talk Ideas

1. Building a backend framework on Node.js core: lessons from StreetJS
2. Implementing the PostgreSQL wire protocol from scratch in TypeScript
3. Memory-safety as a first-class framework concern
4. Two dependencies: a minimalist supply-chain story
5. Property-based testing for backend frameworks at scale
6. Designing a DI container without a module graph
7. Decorator metadata in TypeScript: how StreetJS routing works
8. Realtime at bounded memory: WebSockets and backpressure
9. A signed plugin registry: trust in the npm era
10. Reproducible releases: provenance, SBOMs, and verification artifacts
11. From Express to StreetJS: a migration retrospective
12. SCRAM-SHA-256 and database auth without third-party clients
13. Chaos and fuzz testing a wire protocol
14. Multi-tenancy patterns for TypeScript SaaS
15. Compliance-as-code: mapping controls to framework features
16. Streaming LLM agents over SSE
17. Edge deployment of a Node.js framework
18. Zero-trust certification: shipping nothing without evidence
19. Observability built in: metrics and traces by default
20. The economics of framework adoption: what really blocks teams
21. Governance for a young open-source framework
22. Rate limiting and abuse prevention at the framework layer
23. Field-level encryption and data classification in practice
24. Benchmarking methodology: honest framework comparisons
25. Building an ecosystem: official plugins and the contributor flywheel
