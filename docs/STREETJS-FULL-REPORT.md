# StreetJS — Full Project Report

> Consolidated, evidence-based status report. Claims are tagged **VERIFIED**
> (confirmed with executed evidence this cycle), **IMPLEMENTED** (present in
> source, not re-run here), or **GAP** (missing / unproven). No marketing.
> Generated against `main` on 2026-06-14.

---

## 1. Executive summary

StreetJS is a TypeScript-first backend framework built almost entirely on Node.js
core modules, with a deliberately tiny runtime dependency footprint. It is
**published, tested, and CI-green**, with a broad first-party feature set and an
ecosystem of **18 official, signed plugins**.

- **Engineering / production-readiness:** strong. Build is green, the full CI/CD
  pipeline passes, packages are published with provenance.
- **Adoption-readiness:** limited by *social* factors (community, contributors,
  third-party production usage), not by code quality. See §10.

**Verdict:** ready today for solo developers, internal services, and early
adopters who value supply-chain minimalism; not yet a default for risk-averse
enterprises needing a large ecosystem, hiring pool, and proven longevity.

---

## 2. Published artifacts (VERIFIED on npm)

| Package | Version | Notes |
|---------|---------|-------|
| `streetjs` (core) | **1.0.7** (`latest`) | the framework |
| `@streetjs/core` | **1.0.7** | deprecated compat shim re-exporting `streetjs` |
| `@streetjs/cli` | **1.0.7** | scaffolding / dev CLI |
| `@streetjs/plugin-*` (×18) | **1.0.1** (`latest`) | each with npm provenance + official Ed25519 manifest signature |

Caveat: plugin **v1.0.0** exists on npm with an incorrect (ephemeral) manifest
signature — superseded by v1.0.1. Recommend deprecating v1.0.0. **GAP (minor).**

---

## 3. Architecture & core capabilities

Core ships **37 source modules** (`packages/core/src`). Key subsystems
(**IMPLEMENTED**, exercised by the green CI suite):

- **HTTP & routing:** `streetApp`, decorator routing (`@Controller/@Get/@Post/...`),
  DI container (`@Injectable`), middleware, exceptions, OpenAPI generation.
- **Data:** native PostgreSQL wire-protocol v3 driver with SCRAM-SHA-256 (no `pg`);
  MySQL/MariaDB driver; SQLite (WASM); query builder, repository, migrations,
  seeder, schema inspector, query profiler.
- **Realtime:** WebSocket server, SSE, channel hub, GraphQL subscriptions.
- **Security:** JWT, AES-256-GCM sessions, RBAC, MFA, rate limiting (in-memory +
  Redis), input validation, XSS sanitization, field-level encryption, vault mode,
  mTLS, abuse prevention, moderation toolkit, secret-provider adapters.
- **Platform:** multi-tenancy, jobs + dashboard, webhooks, microservices
  (circuit breaker, saga, event bus), Kafka + RabbitMQ transports, distributed
  cache, replication coordinator.
- **Observability:** Prometheus metrics, OpenTelemetry, Grafana dashboards,
  subsystem metrics, diagnostics.
- **AI:** providers, RAG pipeline, tool-calling agent executor (SSE streaming).

---

## 4. Ecosystem — 18 official plugins (VERIFIED published + signed)

Dependency-free, Ed25519-signed, wired into `street add`:

| Category | Plugins |
|----------|---------|
| Databases | postgres, mysql, **mongodb** (from-scratch BSON + OP_MSG + SCRAM-SHA-256) |
| Messaging | nats, kafka, rabbitmq |
| Payments | stripe, paypal |
| Identity | auth0, clerk, firebase, supabase |
| AI | openai |
| Storage | s3, r2 |
| Email/SMS | sendgrid, twilio |

- Plugin-structure suite: **217/217, 0 skips. VERIFIED.**
- All 18 published v1.0.1 verify against the official signing key via
  `scripts/verify-official-signatures.mjs`: **18/18 OK. VERIFIED.**
- Search backends (Meilisearch/Elasticsearch/OpenSearch) are covered by the
  in-framework `@streetjs/search` package. **IMPLEMENTED.**

---

## 5. Testing (VERIFIED)

- Full `street CI/CD` pipeline **green on main**: core integration tests
  (Node 20 + 22 vs live PostgreSQL), CLI + migration, memory-leak, 6 system-test
  suites (security/memory/load/fuzz/chaos/infra), MySQL integration, certification
  suites + DB E2E, package-integrity clean-install smoke, benchmarks with a
  regression gate.
- CLI suite: **148/148, 0 skips.**
- Property-based testing (fast-check) used throughout core.
- MongoDB plugin: BSON/OP_MSG/SCRAM **offline-verified against the RFC 7677
  vector**, and the live path (connect + SCRAM-SHA-256 auth + insert/find)
  **verified against a real `mongod`** this cycle. Not yet in CI. **GAP (CI only).**

---

## 6. Security & supply chain (VERIFIED)

- Secret scanning: Gitleaks + TruffleHog + GitHub native (`secret-scan.yml`).
- Dependency review + `npm audit --audit-level=high` policy gate.
- Workflow static analysis: **zizmor** (Security Lint job) — green.
- npm **provenance** (Sigstore) on releases; CI provenance gate prevents
  unattested publishes; idempotent publish steps.
- Per-release CycloneDX **SBOM** generation.
- Ed25519 plugin signing with an official key embedded in the trust store
  (`OFFICIAL_PLUGIN_PUBLIC_KEY_PEM`); CI verifies each published manifest.
- `SECURITY.md` (disclosure + severity matrix), `THREAT-MODEL.md`,
  `SECURITY-HARDENING.md`, Actions pinned to commit SHAs.

---

## 7. Deployment (IMPLEMENTED / VERIFIED)

- Distroless Docker image (built + smoke-tested), health endpoints
  (`/health/live`, `/health/ready`).
- Deploy manifests: Cloud Run, AWS ECS, Vercel, Cloudflare Workers.
- 5 reference apps (SaaS, e-commerce, realtime-chat, dating, AI assistant) build,
  smoke-test, and benchmark. **VERIFIED.**

---

## 8. Documentation (IMPLEMENTED)

- ~50 guides + subdirs (getting-started, security, deployment, testing,
  observability), plus migration guides from **Express, NestJS, Fastify**.
- Jekyll docs site with `jekyll-seo-tag`, `jekyll-sitemap`, search, and rich
  JSON-LD (`SoftwareApplication`, `FAQPage`, `BreadcrumbList`, `APIReference`);
  SEO assertions gated in CI (`docs-seo.yml`).

---

## 9. Governance & OSS readiness

- **IMPLEMENTED:** `CONTRIBUTING.md`, `GOVERNANCE.md`, `CODE_OF_CONDUCT.md`,
  `LICENSE` (MIT), `lts-policy.md`, `CODEOWNERS`, issue/PR templates, ADRs.
- **GAP:** no `FUNDING` enrollment yet (file added), no evidence of ≥2 active
  maintainers, RFC process not formalized.

---

## 10. Gaps & honest risks

- **Community ≈ zero. GAP.** No verifiable Discord/Discussions activity or
  external contributors — the single biggest adoption blocker.
- **Single-vendor / bus-factor risk. GAP.**
- **No third-party production proof. GAP.** Reference apps are first-party.
- **Compliance is documentation-only. GAP.** No SOC2/HIPAA/ISO/PCI/GDPR
  certification or control-mapping evidence.
- **Data-layer ergonomics** trail Prisma/TypeORM/Eloquent (no relations /
  model-driven migrations). **GAP vs. competitors.**
- **MongoDB live path not in CI** (verified locally only). **GAP (CI).**
- **Hiring pool** for "StreetJS developers" does not exist. **GAP.**

---

## 11. Readiness by audience

| Profile | Verdict |
|---------|---------|
| Solo devs / internal tools / supply-chain minimalists | **Ready** |
| Small teams comfortable being early adopters | **Ready, eyes open** |
| Mid-size teams needing deep ecosystem + hiring pool | **Not yet** |
| Risk-averse / regulated enterprises | **Not yet** |

## 12. Highest-ROI next steps

1. Deprecate plugin v1.0.0; keep v1.0.1 as the signed/provenant baseline.
2. Stand up community (Discord + GitHub Discussions) and name ≥2 maintainers.
3. Add a MongoDB service container to CI to verify the live path in the pipeline.
4. Compliance control-mapping docs pointing at existing audit-log/RBAC/vault/retention.
5. Data-layer ergonomics: relations + model-driven migrations.
6. Independent production case studies with reproducible benchmarks.

---

### Provenance of this report
Where tagged VERIFIED, claims were confirmed this cycle via: `npm view` against
`registry.npmjs.org`, `gh run` pipeline status, the plugin-structure and CLI test
suites, `scripts/verify-official-signatures.mjs`, and live MongoDB containers.
Items tagged GAP are stated plainly and not papered over.
